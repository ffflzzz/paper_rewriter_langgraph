import "./styles.css";
import { useState, useCallback, useEffect, useRef, Component } from 'react';
import type { ReactNode } from 'react';
import { AgentDashboard } from "./AgentDashboard";
import { SessionSidebar, upsertSession } from "./SessionSidebar";

// 直连AG-UI端点
const AGUI_URL = `${window.location.origin}/pr/api/copilotkit`;

function getOrCreateThreadId(): string {
  const stored = localStorage.getItem('paper_rewriter_thread_id');
  if (stored) return stored;
  const newId = crypto.randomUUID();
  localStorage.setItem('paper_rewriter_thread_id', newId);
  return newId;
}

function saveThreadId(threadId: string) {
  localStorage.setItem('paper_rewriter_thread_id', threadId);
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  timestamp: number;
}

function getMessages(threadId: string): Message[] {
  const stored = localStorage.getItem(`paper_rewriter_msgs_${threadId}`);
  if (stored) { try { return JSON.parse(stored); } catch {} }
  return [];
}

function saveMessages(threadId: string, messages: Message[]) {
  localStorage.setItem(`paper_rewriter_msgs_${threadId}`, JSON.stringify(messages));
}

// Error Boundary
class ErrorBoundary extends Component<{children: ReactNode}, {hasError: boolean, error: string}> {
  constructor(props: {children: ReactNode}) { super(props); this.state = { hasError: false, error: '' }; }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error: error.message }; }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{padding: 20, color: '#f85149', background: '#1a1a2a', borderRadius: 8, margin: 20}}>
          <h3>⚠️ 组件加载失败</h3>
          <p>{this.state.error}</p>
          <button onClick={() => {localStorage.clear(); window.location.reload();}} style={{padding: '8px 16px', marginTop: 10, cursor: 'pointer'}}>
            清除缓存并刷新
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function ChatPanel({ threadId }: { threadId: string }) {
  const [messages, setMessages] = useState<Message[]>(() => getMessages(threadId));
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [toolCalls, setToolCalls] = useState<{name: string; status: string}[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  useEffect(() => { setMessages(getMessages(threadId)); }, [threadId]);

  const scrollToBottom = useCallback(() => {
    if (isAtBottomRef.current) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, streamContent, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text, timestamp: Date.now() };
    const updated = [...messages, userMsg];
    setMessages(updated);
    saveMessages(threadId, updated);
    upsertSession(threadId);
    setInput('');
    setIsStreaming(true);
    setStreamContent('');
    setToolCalls([]);
    isAtBottomRef.current = true;

    try {
      const runId = crypto.randomUUID().slice(0, 8);
      const resp = await fetch(AGUI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId, runId, state: {},
          messages: updated.map(m => ({ id: m.id, role: m.role, content: m.content })),
          tools: [], context: [], forwardedProps: {},
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body?.getReader();
      if (!reader) throw new Error('No reader');
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      const toolMsgs: Message[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            // RAW chat model stream
            if (evt.type === 'RAW' && evt.event?.event === 'on_chat_model_stream') {
              const c = evt.event.data?.chunk?.content || '';
              if (c) { fullContent += c; setStreamContent(fullContent); }
            }
            // AG-UI TEXT_MESSAGE
            if (evt.type === 'TEXT_MESSAGE_CONTENT') {
              const c = evt.content || '';
              if (c) { fullContent += c; setStreamContent(fullContent); }
            }
            // Tool events
            if (evt.type === 'TOOL_CALL_START') {
              setToolCalls(prev => [...prev, { name: evt.name || evt.toolName || 'tool', status: 'running' }]);
            }
            if (evt.type === 'TOOL_CALL_END') {
              setToolCalls(prev => prev.map((tc, i) => i === prev.length - 1 ? { ...tc, status: 'done' } : tc));
            }
            if (evt.type === 'RAW' && evt.event?.event === 'on_tool_start') {
              setToolCalls(prev => [...prev, { name: evt.event.name || 'tool', status: 'running' }]);
            }
            if (evt.type === 'RAW' && evt.event?.event === 'on_tool_end') {
              const name = evt.event.name || 'tool';
              const output = String(evt.event.data?.output || '').slice(0, 200);
              toolMsgs.push({ id: crypto.randomUUID(), role: 'tool', content: `[${name}] ${output}`, toolName: name, timestamp: Date.now() });
              setToolCalls(prev => prev.map((tc, i) => i === prev.length - 1 ? { ...tc, status: 'done' } : tc));
            }
          } catch {}
        }
      }

      const finalMsgs: Message[] = [...updated];
      if (fullContent) {
        finalMsgs.push({ id: crypto.randomUUID(), role: 'assistant', content: fullContent, timestamp: Date.now() });
      }
      finalMsgs.push(...toolMsgs);
      setMessages(finalMsgs);
      saveMessages(threadId, finalMsgs);
      upsertSession(threadId);
    } catch (e: any) {
      const errMsg: Message = { id: crypto.randomUUID(), role: 'assistant', content: `[错误] ${e.message}`, timestamp: Date.now() };
      const final = [...updated, errMsg];
      setMessages(final);
      saveMessages(threadId, final);
    } finally {
      setIsStreaming(false);
      setStreamContent('');
      setToolCalls([]);
    }
  }, [input, isStreaming, messages, threadId]);

  return (
    <div className="chat-panel">
      <div className="chat-messages" ref={scrollContainerRef} onScroll={handleScroll}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>你好！我是论文重写助手。</p>
            <p>请提供论文标题或关键词，我会搜索相关论文。</p>
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} className={`chat-msg ${msg.role}`}>
            <div className="chat-msg-content">{msg.content}</div>
          </div>
        ))}
        {isStreaming && streamContent && (
          <div className="chat-msg assistant streaming">
            <div className="chat-msg-content">{streamContent}</div>
          </div>
        )}
        {isStreaming && toolCalls.length > 0 && (
          <div className="chat-tools">
            {toolCalls.map((tc, i) => (
              <div key={i} className={`chat-tool ${tc.status}`}>
                {tc.status === 'running' ? '🔄' : '✅'} {tc.name}
              </div>
            ))}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="chat-input-area">
        <textarea
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          placeholder="输入消息... (Enter发送, Shift+Enter换行)"
          disabled={isStreaming}
        />
        <button className="chat-send-btn" onClick={sendMessage} disabled={isStreaming || !input.trim()}>
          {isStreaming ? '⏳' : '▶'}
        </button>
      </div>
    </div>
  );
}

function App() {
  const [threadId, setThreadId] = useState(() => getOrCreateThreadId());

  useEffect(() => {
    document.documentElement.classList.add('dark');
    return () => document.documentElement.classList.remove('dark');
  }, []);

  const handleSwitchThread = useCallback((newThreadId: string) => {
    setThreadId(newThreadId);
    saveThreadId(newThreadId);
  }, []);

  const handleNewThread = useCallback(() => {
    const newId = crypto.randomUUID();
    setThreadId(newId);
    saveThreadId(newId);
  }, []);

  return (
    <div className="app-container">
      <SessionSidebar currentThreadId={threadId} onSwitchThread={handleSwitchThread} onNewThread={handleNewThread} />
      <ErrorBoundary>
        <div className="app-layout">
          <main className="main-content">
            <div className="dashboard-container">
              <AgentDashboard runtimeUrl="" />
            </div>
          </main>
          <ChatPanel threadId={threadId} />
        </div>
      </ErrorBoundary>
    </div>
  );
}

export default App;
