import { useState, useEffect } from 'react';

interface ChatSession {
  id: string;
  title: string;
  created_at: number;
  last_active: number;
  message_count: number;
}

interface SessionSidebarProps {
  currentThreadId: string;
  onSwitchThread: (threadId: string) => void;
  onNewThread: () => void;
}

const API = `${window.location.origin}/pr/api`;

// ── 服务端Session API ──

export async function apiUpsertSession(id: string, title: string = "") {
  try {
    await fetch(`${API}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, title }),
    });
  } catch (e) { console.error('apiUpsertSession failed:', e); }
}

export async function apiAddMessage(sessionId: string, id: string, role: string, content: string, toolName: string = "") {
  try {
    await fetch(`${API}/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, role, content, tool_name: toolName }),
    });
  } catch (e) { console.error('apiAddMessage failed:', e); }
}

export async function apiGetMessages(sessionId: string): Promise<any[]> {
  try {
    const resp = await fetch(`${API}/sessions/${sessionId}/messages`);
    if (resp.ok) {
      const data = await resp.json();
      return data.messages || [];
    }
  } catch (e) { console.error('apiGetMessages failed:', e); }
  return [];
}

async function apiDeleteSession(id: string) {
  try {
    await fetch(`${API}/sessions/${id}`, { method: 'DELETE' });
  } catch (e) { console.error('apiDeleteSession failed:', e); }
}

// ── 组件 ──

export function SessionSidebar({ currentThreadId, onSwitchThread, onNewThread }: SessionSidebarProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    const refresh = async () => {
      try {
        const resp = await fetch(`${API}/sessions`);
        if (resp.ok) {
          const data = await resp.json();
          setSessions(data.sessions || []);
        }
      } catch (e) {}
    };
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (ts: number) => {
    const diff = Date.now() - ts * 1000;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    return new Date(ts * 1000).toLocaleDateString();
  };

  const handleDelete = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    await apiDeleteSession(sessionId);
    const resp = await fetch(`${API}/sessions`);
    if (resp.ok) {
      const data = await resp.json();
      setSessions(data.sessions || []);
    }
    if (currentThreadId === sessionId) {
      onNewThread();
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
                      <span className="session-time">{formatTime(session.last_active)}</span>
                      <span className="session-messages">{session.message_count} 条</span>
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
