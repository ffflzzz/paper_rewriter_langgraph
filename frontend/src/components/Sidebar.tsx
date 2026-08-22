import type { RunSummary } from '../types'

interface Props {
  runs: RunSummary[]
  activeRunId: string | null
  onSelect: (runId: string) => void
  onNew: () => void
}

export function Sidebar({ runs, activeRunId, onSelect, onNew }: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">文</div>
        <div>
          <h1>论文重写 Agent</h1>
          <span>LangGraph · ReAct</span>
        </div>
      </div>

      <button className="btn-primary" onClick={onNew}>
        ＋ 新建重写任务
      </button>

      <div className="sidebar-label">历史运行</div>
      <nav className="run-list">
        {runs.length === 0 && <div className="empty-hint">暂无运行记录</div>}
        {runs.map((r) => (
          <button
            key={r.run_id}
            className={`run-item${r.run_id === activeRunId ? ' active' : ''}`}
            onClick={() => onSelect(r.run_id)}
          >
            <span className="run-title">{r.paper_title || r.run_id}</span>
            <span className="run-meta">
              {r.chapters_written} 章 · {fmtChars(r.total_chars)} · {fmtDate(r.created_at)}
            </span>
          </button>
        ))}
      </nav>
    </aside>
  )
}

export function fmtChars(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万字`
  return `${n} 字`
}

export function fmtDate(ts: number): string {
  const d = new Date(ts * 1000)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
