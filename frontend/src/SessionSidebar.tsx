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

// ── localStorage → 服务端迁移 ──

async function migrateLocalStorage() {
  // 检查是否已迁移
  if (localStorage.getItem('sessions_migrated')) return;

  try {
    // 迁移session列表
    const sessionsRaw = localStorage.getItem('paper_rewriter_sessions');
    if (sessionsRaw) {
      const sessions = JSON.parse(sessionsRaw);
      for (const s of sessions) {
        await apiUpsertSession(s.id, s.title || '');
        // 迁移消息
        const msgsRaw = localStorage.getItem(`paper_rewriter_msgs_${s.id}`);
        if (msgsRaw) {
          const msgs = JSON.parse(msgsRaw);
          for (const m of msgs) {
            await apiAddMessage(s.id, m.id, m.role, m.content, m.toolName || '');
          }
        }
      }
    }

    // 迁移当前threadId的消息（如果不在sessions列表里）
    const currentId = localStorage.getItem('paper_rewriter_thread_id');
    if (currentId) {
      const msgsRaw = localStorage.getItem(`paper_rewriter_msgs_${currentId}`);
      if (msgsRaw) {
        const msgs = JSON.parse(msgsRaw);
        if (msgs.length > 0) {
          await apiUpsertSession(currentId, msgs.find((m: any) => m.role === 'user')?.content?.slice(0, 30) || '会话');
          for (const m of msgs) {
            await apiAddMessage(currentId, m.id, m.role, m.content, m.toolName || '');
          }
        }
      }
    }

    localStorage.setItem('sessions_migrated', '1');
    console.log('Sessions migrated from localStorage to server');
  } catch (e) {
    console.error('Migration failed:', e);
  }
}

// ── 组件 ──

export function SessionSidebar({ currentThreadId, onSwitchThread, onNewThread }: SessionSidebarProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    // 先迁移localStorage数据，再加载session列表
    const init = async () => {
      await migrateLocalStorage();
      await refresh();
    };
    init();

    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, []);

  const refresh = async () => {
    try {
      const resp = await fetch(`${API}/sessions`);
      if (resp.ok) {
        const data = await resp.json();
        setSessions(data.sessions || []);
      }
    } catch (e) {}
  };

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
    refresh();
    if (currentThreadId === sessionId) onNewThread();
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
