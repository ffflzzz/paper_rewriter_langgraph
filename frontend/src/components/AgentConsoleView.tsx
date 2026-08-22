import { useEffect, useState } from 'react'
import type { RunStatus, FeedItem } from '../types'
import type { LoopStage } from '../hooks'
import { api } from '../api'
import { LoopConsole } from './LoopConsole'
import { VirtualFeed } from './VirtualFeed'
import { ChapterDrawer } from './ChapterDrawer'
import { fmtChars } from './Sidebar'

interface Props {
  status: RunStatus
  items: FeedItem[]
  stage: LoopStage
  sseConnected: boolean
  onClear: () => void
}

const STATUS_META: Record<RunStatus['status'], { label: string; cls: string }> = {
  idle: { label: '空闲', cls: 'st-idle' },
  running: { label: '运行中', cls: 'st-running' },
  completed: { label: '已完成', cls: 'st-done' },
  stopped: { label: '已停止', cls: 'st-stopped' },
  error: { label: '出错', cls: 'st-error' },
}

/** 右侧独占版面：Agent Loop 动画 + 虚拟滚动事件流 */
export function AgentConsoleView({ status, items, stage, sseConnected }: Props) {
  const [elapsed, setElapsed] = useState('')
  const [openChapter, setOpenChapter] = useState<string | null>(null)
  const [instruction, setInstruction] = useState('')
  const [showInstruction, setShowInstruction] = useState(false)
  const [deciding, setDeciding] = useState(false)
  const meta = STATUS_META[status.status] ?? STATUS_META.idle
  const awaiting = status.awaiting

  async function decide(decision: boolean | string) {
    if (!status.run_id) return
    setDeciding(true)
    try {
      await api.resume(status.run_id!, decision)
      setInstruction('')
      setShowInstruction(false)
    } catch (e) {
      alert(`操作失败：${e}`)
    } finally {
      setDeciding(false)
    }
  }

  useEffect(() => {
    if (!status.started_at) return
    const end = status.ended_at ?? Date.now() / 1000
    const tick = () => {
      const s = Math.max(0, Math.floor(end - status.started_at!))
      setElapsed(
        `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`,
      )
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [status.started_at, status.ended_at])

  const chapterIds = Object.keys(status.chapters).sort(
    (a, b) => (Number(a.replace(/\D/g, '')) || 0) - (Number(b.replace(/\D/g, '')) || 0),
  )
  const totalChars = chapterIds.reduce((n, id) => n + (status.chapters[id]?.chars ?? 0), 0)

  async function handleStop() {
    if (!confirm('确认停止当前运行？')) return
    await fetch('/api/stop', { method: 'POST' })
  }

  return (
    <section className="console">
      <header className="console-head">
        <div className="ch-left">
          <span className={`status-pill ${meta.cls}`}>
            {status.status === 'running' && <i className="pulse" />}
            {meta.label}
          </span>
          <code className="run-id">{status.run_id}</code>
          {!sseConnected && <span className="sse-warn">SSE 重连中…</span>}
        </div>
        <div className="ch-right">
          {status.status === 'running' && (
            <button className="btn-danger" onClick={handleStop}>■ 停止</button>
          )}
        </div>
      </header>

      <div className="console-stats">
        <div className="stat"><b>{status.tool_calls}</b><span>工具调用</span></div>
        <div className="stat"><b>{chapterIds.length}</b><span>章节</span></div>
        <div className="stat"><b>{fmtChars(totalChars)}</b><span>累计字数</span></div>
        <div className="stat"><b>{elapsed || '--:--'}</b><span>耗时</span></div>
      </div>

      <LoopConsole stage={awaiting ? 'wait' : stage} />

      {awaiting && (
        <div className="approval-card">
          <div className="ap-head">
            <span className="ap-badge">⏸ 待确认</span>
            <b>{awaiting.tool}</b>
          </div>
          <p className="ap-reason">{awaiting.reason}</p>
          {awaiting.args && <code className="ap-args">{awaiting.args}</code>}

          {!showInstruction ? (
            <div className="ap-actions">
              <button className="btn-primary" disabled={deciding} onClick={() => decide(true)}>
                ✅ 批准
              </button>
              <button className="btn-ghost" disabled={deciding} onClick={() => setShowInstruction(true)}>
                ✏️ 批准并指示…
              </button>
              <button className="btn-danger" disabled={deciding} onClick={() => decide(false)}>
                ✖ 跳过
              </button>
            </div>
          ) : (
            <div className="ap-instruct">
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={3}
                placeholder="给 Agent 的指示将随批准一起传入（例如：第三章太浅，请展开自注意力公式的直觉解释）"
              />
              <div className="ap-actions">
                <button
                  className="btn-primary"
                  disabled={deciding || instruction.trim().length === 0}
                  onClick={() => decide(instruction.trim())}
                >
                  发送指示并批准
                </button>
                <button className="btn-ghost" disabled={deciding} onClick={() => setShowInstruction(false)}>
                  返回
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {(status.last_action || status.error) && (
        <p className="last-action">
          {status.error ? (
            <span className="form-inline-error">⚠ {status.error}</span>
          ) : (
            <>最近动作：<strong>{status.last_action}</strong></>
          )}
        </p>
      )}

      {chapterIds.length > 0 && (
        <div className="chapter-strip">
          <span className="strip-label">章节</span>
          {chapterIds.map((id) => (
            <button key={id} className="chip" onClick={() => setOpenChapter(id)}>
              {id} · {status.chapters[id]?.chars ?? 0} 字
            </button>
          ))}
        </div>
      )}

      <div className="feed-zone">
        <div className="feed-zone-head">
          <h3>Agent 事件流</h3>
          <span className="vfeed-meta">{items.length} 条 · 虚拟渲染</span>
        </div>
        <VirtualFeed items={items} />
      </div>

      {openChapter && status.run_id && (
        <ChapterDrawer runId={status.run_id} chapterId={openChapter} onClose={() => setOpenChapter(null)} />
      )}
    </section>
  )
}
