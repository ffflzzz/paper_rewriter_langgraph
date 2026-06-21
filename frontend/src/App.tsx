import "./styles.css";
import { useState, useCallback, useEffect } from 'react';
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import { AgentDashboard } from "./AgentDashboard";
import { SessionSidebar } from "./SessionSidebar";

// ── 直连AG-UI端点（绕过CopilotKit Runtime） ──
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
        runtimeUrl={AGUI_URL}
        agent="paper_rewriter"
        threadId={threadId}
      >
        <div className="app-layout">
          <main className="main-content">
            <div className="dashboard-container">
              <AgentDashboard runtimeUrl={AGUI_URL} />
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
    </div>
  );
}

export default App;
