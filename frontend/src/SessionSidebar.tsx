import { useState, useEffect } from 'react';

interface Session {
  id: string;
  title: string;
  createdAt: string;
  lastActive: string;
  messageCount: number;
}

interface SessionSidebarProps {
  currentThreadId: string;
  onSwitchThread: (threadId: string) => void;
  onNewThread: () => void;
}

export function SessionSidebar({ currentThreadId, onSwitchThread, onNewThread }: SessionSidebarProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isOpen, setIsOpen] = useState(true);

  // 从localStorage加载sessions，如果没有则创建默认session
  useEffect(() => {
    const stored = localStorage.getItem('paper_rewriter_sessions');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setSessions(parsed);
      } catch (e) {
        console.error('Failed to parse sessions:', e);
        createDefaultSession();
      }
    } else {
      createDefaultSession();
    }
  }, []);

  // 创建默认session
  const createDefaultSession = () => {
    const newSession: Session = {
      id: currentThreadId,
      title: '默认会话',
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
      messageCount: 0,
    };
    setSessions([newSession]);
    localStorage.setItem('paper_rewriter_sessions', JSON.stringify([newSession]));
  };

  // 保存sessions到localStorage
  const saveSessions = (newSessions: Session[]) => {
    setSessions(newSessions);
    localStorage.setItem('paper_rewriter_sessions', JSON.stringify(newSessions));
  };

  // 创建新session
  const createNewSession = () => {
    const newId = crypto.randomUUID();
    const newSession: Session = {
      id: newId,
      title: `会话 ${sessions.length + 1}`,
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
      messageCount: 0,
    };
    saveSessions([newSession, ...sessions]);
    onNewThread();
  };

  // 切换session
  const switchSession = (sessionId: string) => {
    const updated = sessions.map(s => 
      s.id === sessionId ? { ...s, lastActive: new Date().toISOString() } : s
    );
    saveSessions(updated);
    onSwitchThread(sessionId);
  };

  // 删除session
  const deleteSession = (sessionId: string) => {
    const filtered = sessions.filter(s => s.id !== sessionId);
    saveSessions(filtered);
    if (currentThreadId === sessionId && filtered.length > 0) {
      switchSession(filtered[0].id);
    }
  };

  // 格式化时间
  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    return date.toLocaleDateString();
  };

  return (
    <div className={`session-sidebar ${isOpen ? 'open' : 'closed'}`}>
      <div className="session-header">
        <h3>📋 会话列表</h3>
        <button className="btn-toggle" onClick={() => setIsOpen(!isOpen)}>
          {isOpen ? '◀' : '▶'}
        </button>
      </div>

      {isOpen && (
        <>
          <button className="btn-new-session" onClick={createNewSession}>
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
                  onClick={() => switchSession(session.id)}
                >
                  <div className="session-info">
                    <div className="session-title">{session.title}</div>
                    <div className="session-meta">
                      <span className="session-time">{formatTime(session.lastActive)}</span>
                      <span className="session-messages">{session.messageCount} 条消息</span>
                    </div>
                  </div>
                  <div className="session-actions">
                    <button
                      className="btn-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSession(session.id);
                      }}
                      title="删除"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
