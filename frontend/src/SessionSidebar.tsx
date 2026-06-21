import { useState, useEffect } from 'react';

interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  lastActive: number;
  messageCount: number;
}

interface SessionSidebarProps {
  currentThreadId: string;
  onSwitchThread: (threadId: string) => void;
  onNewThread: () => void;
}

// ── Session localStorage 管理 ──

const SESSIONS_KEY = 'paper_rewriter_sessions';

function loadSessions(): ChatSession[] {
  const stored = localStorage.getItem(SESSIONS_KEY);
  if (stored) {
    try { return JSON.parse(stored); } catch {}
  }
  return [];
}

function saveSessions(sessions: ChatSession[]) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

/** 外部调用：发消息时更新session */
export function upsertSession(threadId: string, title?: string) {
  const sessions = loadSessions();
  const idx = sessions.findIndex(s => s.id === threadId);
  const now = Date.now();

  // 从localStorage读取消息数量
  const msgsKey = `paper_rewriter_msgs_${threadId}`;
  const msgs = localStorage.getItem(msgsKey);
  const messageCount = msgs ? JSON.parse(msgs).length : 0;

  // 用第一条用户消息作为标题
  let sessionTitle = title;
  if (!sessionTitle && msgs) {
    try {
      const parsed = JSON.parse(msgs);
      const firstUser = parsed.find((m: any) => m.role === 'user');
      sessionTitle = firstUser?.content?.slice(0, 30) || `会话 ${sessions.length + 1}`;
    } catch {
      sessionTitle = `会话 ${sessions.length + 1}`;
    }
  }

  if (idx >= 0) {
    sessions[idx].lastActive = now;
    sessions[idx].messageCount = messageCount;
    if (sessionTitle) sessions[idx].title = sessionTitle;
  } else {
    sessions.unshift({
      id: threadId,
      title: sessionTitle || `会话 ${sessions.length + 1}`,
      createdAt: now,
      lastActive: now,
      messageCount,
    });
  }

  saveSessions(sessions);
}

/** 外部调用：删除session */
export function deleteSession(threadId: string) {
  const sessions = loadSessions().filter(s => s.id !== threadId);
  saveSessions(sessions);
  localStorage.removeItem(`paper_rewriter_msgs_${threadId}`);
}

// ── 组件 ──

export function SessionSidebar({ currentThreadId, onSwitchThread, onNewThread }: SessionSidebarProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [isOpen, setIsOpen] = useState(true);

  // 定期刷新session列表
  useEffect(() => {
    const refresh = () => setSessions(loadSessions());
    refresh();
    const interval = setInterval(refresh, 2000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (ts: number) => {
    const diff = Date.now() - ts;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    return new Date(ts).toLocaleDateString();
  };

  const handleDelete = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    deleteSession(sessionId);
    setSessions(loadSessions());
    if (currentThreadId === sessionId) {
      const remaining = loadSessions();
      if (remaining.length > 0) {
        onSwitchThread(remaining[0].id);
      } else {
        onNewThread();
      }
    }
  };

  return (
    <div className={`session-sidebar ${isOpen ? 'open' : 'closed'}`}>
      <div className="session-header">
        <h3>📋 会话</h3>
        <button className="btn-toggle" onClick={() => setIsOpen(!isOpen)}>
          {isOpen ? '◀' : '▶'}
        </button>
      </div>

      {isOpen && (
        <>
          <button className="btn-new-session" onClick={onNewThread}>
            ➕ 新建会话
          </button>

          <div className="session-list">
            {sessions.length === 0 ? (
              <div className="session-empty">暂无会话</div>
            ) : (
              sessions.map(session => (
                <div
                  key={session.id}
                  className={`session-item ${session.id === currentThreadId ? 'active' : ''}`}
                  onClick={() => onSwitchThread(session.id)}
                >
                  <div className="session-info">
                    <div className="session-title">{session.title}</div>
                    <div className="session-meta">
                      <span className="session-time">{formatTime(session.lastActive)}</span>
                      <span className="session-messages">{session.messageCount} 条</span>
                    </div>
                  </div>
                  <button
                    className="btn-delete"
                    onClick={(e) => handleDelete(e, session.id)}
                    title="删除"
                  >
                    🗑
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
