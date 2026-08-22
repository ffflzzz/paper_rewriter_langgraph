import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import type { RunStatus, RunSummary, FeedItem, AgentEvent } from './types'

/** 轮询运行状态（SSE 只推事件增量，状态以轮询为准） */
export function useRunStatus(intervalMs = 2500) {
  const [status, setStatus] = useState<RunStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const tick = () =>
      api
        .status()
        .then((s) => {
          if (alive) {
            setStatus(s)
            setError(null)
          }
        })
        .catch((e) => alive && setError(String(e)))
    tick()
    const t = setInterval(tick, intervalMs)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [intervalMs])

  return { status, error }
}

/** 历史运行列表 */
export function useRuns() {
  const [runs, setRuns] = useState<RunSummary[]>([])
  const reload = () => api.runs().then(setRuns).catch(() => setRuns([]))
  useEffect(() => {
    reload()
    const t = setInterval(reload, 8000)
    return () => clearInterval(t)
  }, [])
  return { runs, reload }
}

/** Agent 循环阶段（由最新事件推导，驱动循环动画） */
export type LoopStage = 'idle' | 'think' | 'tool' | 'result' | 'wait' | 'done' | 'error'

const STAGE_OF: Record<AgentEvent['event'], LoopStage> = {
  agent_start: 'think',
  agent_message: 'think',
  tool_call: 'tool',
  tool_result: 'result',
  interrupt: 'wait',
  agent_complete: 'done',
  agent_error: 'error',
}

let feedSeq = 0

/** SSE 实时事件流：追加式 feed + 当前循环阶段（自动重连） */
export function useAgentFeed(enabled: boolean) {
  const [items, setItems] = useState<FeedItem[]>([])
  const [stage, setStage] = useState<LoopStage>('idle')
  const [connected, setConnected] = useState(false)
  const stageTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!enabled) return
    const push = (kind: AgentEvent['event'], item: Omit<FeedItem, 'id' | 'at' | 'kind'>) => {
      setItems((prev) => [...prev.slice(-499), { ...item, kind, id: ++feedSeq, at: Date.now() }])
      const next = STAGE_OF[kind]
      if (next === 'think' || next === 'tool') {
        setStage(next)
        // result 阶段是瞬态：短暂点亮后回到 think 等待下一步
        window.clearTimeout(stageTimer.current)
      }
      if (next === 'result') {
        setStage('result')
        window.clearTimeout(stageTimer.current)
        stageTimer.current = window.setTimeout(() => setStage('think'), 1400)
      }
    }

    const es = new EventSource('/api/events')
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)
    es.addEventListener('heartbeat', () => setConnected(true))

    const on = (name: AgentEvent['event'], fn: (d: Record<string, string>) => void) =>
      es.addEventListener(name, (e) => {
        try {
          fn(JSON.parse((e as MessageEvent).data))
        } catch {
          /* 忽略坏帧 */
        }
      })

    on('agent_start', (d) =>
      push('agent_start', { title: `开始重写《${d.paper_title}》`, sub: `run ${d.run_id}` }),
    )
    on('agent_message', (d) =>
      push('agent_message', { title: 'Thinking', body: d.content }),
    )
    on('tool_call', (d) =>
      push('tool_call', { title: `Tool · ${d.tool}`, sub: `第 ${d.count} 次调用`, body: d.args }),
    )
    on('tool_result', (d) => push('tool_result', { title: 'Result', body: d.result }))
    on('interrupt', (d) =>
      push('agent_message', { title: `⏸ 等待确认 · ${d.tool}`, body: d.reason }),
    )
    on('agent_complete', (d) =>
      push('agent_complete', { title: `完成 · 共 ${d.tool_calls} 次工具调用` }),
    )
    on('agent_error', (d) => push('agent_error', { title: '出错', body: d.error }))

    return () => {
      es.close()
      setConnected(false)
      window.clearTimeout(stageTimer.current)
    }
  }, [enabled])

  const clear = () => {
    setItems([])
    setStage('idle')
  }
  return { items, stage, connected, clear }
}
