import "./styles.css";
import { useState, useCallback, useEffect, useRef } from 'react';
import { AgentDashboard } from "./AgentDashboard";
import { SessionSidebar } from "./SessionSidebar";

// ── 直连AG-UI端点（不走CopilotKit Runtime） ──

const AGUI_URL = `${window.location.origin}/pr/api/copilotkit`;

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

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

function getMessages(threadId: string): Message[] {
  const stored = localStorage.getItem(`paper_rewriter_msgs_${threadId}`);
  if (stored) {
    try { return JSON.parse(stored); } catch {}
  }
  return [];
}

function saveMessages(threadId: string, messages: Message[]) {
  localStorage.setItem(`paper_rewriter_msgs_${threadId}`, JSON.stringify(messages));
}

function ChatPanel({ threadId }: { threadId: string }) {
  const [messages, setMessages] = useState<Message[]>(() => getMessages(threadId));
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages(getMessages(threadId));
  }, [threadId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamContent]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    const updated = [...messages, userMsg];
    setMessages(updated);
    saveMessages(threadId, updated);
    setInput('');
    setIsStreaming(true);
    setStreamContent('');

    try {
      const runId = crypto.randomUUID().slice(0, 8);
      const resp = await fetch(AGUI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId,
          runId,
          state: {},
          messages: updated.map(m => ({ id: m.id, role: m.role, content: m.content })),
          tools: [],
          context: [],
          forwardedProps: {},
        }),
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const reader = resp.body?.getReader();
      if (!reader) throw new Error('No reader');

      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          try {
            const evt = JSON.parse(data);
            if (evt.type === 'RAW' && evt.event?.event === 'on_chat_model_stream') {
              const content = evt.event.data?.chunk?.content || '';
              if (content) {
                fullContent += content;
                setStreamContent(fullContent);
              }
            }
            if (evt.type === 'RAW' && evt.event?.event === 'on_tool_end') {
              // Tool result - could display
            }
          } catch {}
        }
      }

      if (fullContent) {
        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: fullContent,
          timestamp: Date.now(),
        };
        const final = [...updated, assistantMsg];
        setMessages(final);
        saveMessages(threadId, final);
      }
    } catch (e: any) {
      const errMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `[错误] ${e.message}`,
        timestamp: Date.now(),
      };
      const final = [...updated, errMsg];
      setMessages(final);
      saveMessages(threadId, final);
    } finally {
      setIsStreaming(false);
      setStreamContent('');
    }
  }, [input, isStreaming, messages, threadId]);

  return (
    <div className="chat-panel">
      <div className="chat-messages">
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
      <SessionSidebar
        currentThreadId={threadId}
        onSwitchThread={handleSwitchThread}
        onNewThread={handleNewThread}
      />
      <div className="app-layout">
        <main className="main-content">
          <div className="dashboard-container">
            <AgentDashboard runtimeUrl="" />
          </div>
        </main>
        <ChatPanel threadId={threadId} />
      </div>
    </div>
  );
}

export default App;
