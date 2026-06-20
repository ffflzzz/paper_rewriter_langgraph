import "./styles.css";
import { useState, useCallback, useEffect } from 'react';
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import { AgentDashboard } from "./AgentDashboard";
import { SessionSidebar } from "./SessionSidebar";

// ── Session持久化 ──

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

// ── 主应用 ──

const RUNTIME_URL = `${window.location.origin}/pr-rt/api/copilotkit`;

function App() {
  const [threadId, setThreadId] = useState(() => getOrCreateThreadId());
  
  useEffect(() => {
    document.documentElement.classList.add('dark');
    return () => document.documentElement.classList.remove('dark');
  }, []);
  
  const handleSwitchThread = useCallback((newThreadId: string) => {
    setThreadId(newThreadId);
    saveThreadId(newThreadId);
    window.location.reload();
  }, []);
  
  const handleNewThread = useCallback(() => {
    const newId = crypto.randomUUID();
    setThreadId(newId);
    saveThreadId(newId);
    window.location.reload();
  }, []);
  
  return (
    <div className="app-container">
      <SessionSidebar
        currentThreadId={threadId}
        onSwitchThread={handleSwitchThread}
        onNewThread={handleNewThread}
      />
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
              initial: "你好！我是论文重写助手。\n\n请提供论文标题或关键词，我会搜索相关论文。\n\n确认选择后，我会自动下载PDF并开始重写。\n\n支持上传 PDF/TXT 文件。",
            }}
            attachments={{
              enabled: true,
              accept: ".pdf,.txt,.md,.doc,.docx",
              maxSize: 50 * 1024 * 1024,
            }}
          />
        </div>
      </CopilotKit>
    </div>
  );
}

export default App;
