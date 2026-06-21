import "./styles.css";
import { useState, useCallback, useEffect, Component } from 'react';
import type { ReactNode } from 'react';
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import { AgentDashboard } from "./AgentDashboard";
import { SessionSidebar } from "./SessionSidebar";

// CopilotKit Runtime (端口8766)
const RUNTIME_URL = `${window.location.origin}/pr-rt/api/copilotkit`;

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

// Error Boundary — 防止CopilotKit崩溃拖垮整个页面
class ErrorBoundary extends Component<{children: ReactNode}, {hasError: boolean, error: string}> {
  constructor(props: {children: ReactNode}) {
    super(props);
    this.state = { hasError: false, error: '' };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
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
      <ErrorBoundary>
        <CopilotKit
          runtimeUrl={RUNTIME_URL}
          agent="paper_rewriter"
          threadId={threadId}
        >
          <div className="app-layout">
            <main className="main-content">
              <div className="dashboard-container">
                <AgentDashboard runtimeUrl={RUNTIME_URL} />
              </div>
            </main>
            <CopilotSidebar
              defaultOpen={true}
              clickOutsideToClose={false}
              hitEscapeToClose={false}
              labels={{
                title: "论文重写助手",
                initial: "你好！我是论文重写助手。\n\n请提供论文标题或关键词，我会搜索相关论文。\n\n支持上传 PDF/TXT 文件。",
              }}
              suggestions={[
                { title: "搜索论文", message: "搜索关于 Transformer 的论文" },
                { title: "重写论文", message: "帮我重写一篇论文" },
                { title: "列出章节", message: "列出已写的章节" },
              ]}
            />
          </div>
        </CopilotKit>
      </ErrorBoundary>
    </div>
  );
}

export default App;
