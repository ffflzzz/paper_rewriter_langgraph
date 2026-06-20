import { useState, useEffect } from 'react';

interface RunMeta {
  run_id: string;
  paper_title?: string;
  original_chars?: number;
  created_at?: number;
  status?: string;
}

interface SessionSidebarProps {
  currentThreadId: string;
  onSwitchThread: (threadId: string) => void;
  onNewThread: () => void;
}

export function SessionSidebar({ currentThreadId, onSwitchThread, onNewThread }: SessionSidebarProps) {
  const [runs, setRuns] = useState<RunMeta[]>([]);
  const [isOpen, setIsOpen] = useState(true);
  const [loading, setLoading] = useState(false);

  // 从服务端加载pipeline运行历史
  useEffect(() => {
    loadRuns();
    const interval = setInterval(loadRuns, 10000); // 每10秒刷新
    return () => clearInterval(interval);
  }, []);

  const loadRuns = async () => {
    try {
      setLoading(true);
      const base = window.location.origin;
      const resp = await fetch(`${base}/pr/api/runs`);
      if (resp.ok) {
        const data = await resp.json();
        setRuns(data.runs || []);
      }
    } catch (e) {
      console.error('Failed to load runs:', e);
    } finally {
      setLoading(false);
    }
  };

  // 格式化时间
  const formatTime = (ts?: number) => {
    if (!ts) return '';
    const date = new Date(ts * 1000);
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

  // 格式化字数
  const formatChars = (chars?: number) => {
    if (!chars) return '';
    if (chars < 1000) return `${chars}字`;
    return `${(chars / 1000).toFixed(1)}K字`;
  };

  return (
    <div className={`session-sidebar ${isOpen ? 'open' : 'closed'}`}>
      <div className="session-header">
        <h3>📋 运行历史</h3>
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
            {loading && runs.length === 0 ? (
              <div className="session-empty">加载中...</div>
            ) : runs.length === 0 ? (
              <div className="session-empty">暂无运行记录</div>
            ) : (
              runs.map(run => (
                <div
                  key={run.run_id}
                  className={`session-item ${run.run_id === currentThreadId ? 'active' : ''}`}
                  onClick={() => onSwitchThread(run.run_id)}
                >
                  <div className="session-info">
                    <div className="session-title">
                      {run.paper_title || run.run_id}
                    </div>
                    <div className="session-meta">
                      <span className="session-time">{formatTime(run.created_at)}</span>
                      <span className="session-messages">{formatChars(run.original_chars)}</span>
                    </div>
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
