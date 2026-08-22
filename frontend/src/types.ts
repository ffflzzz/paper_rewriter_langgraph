/** 后端 API 类型（对应 server/agent_app.py） */

export interface RunStatus {
  run_id: string | null
  status: 'idle' | 'running' | 'completed' | 'stopped' | 'error'
  started_at: number | null
  ended_at: number | null
  error: string
  tool_calls: number
  last_action: string
  auto_approve?: boolean
  awaiting?: AwaitingInfo | null
  chapters: Record<string, { chars: number; written_at: number }>
}

/** HITL 挂起信息（等待人工确认） */
export interface AwaitingInfo {
  tool: string
  reason: string
  args: string
}

export interface RunSummary {
  run_id: string
  paper_title: string
  original_chars: number
  chapters_written: number
  total_chars: number
  created_at: number
}

export interface GraphNode {
  id: string
  label: string
  type: string
}

export interface GraphEdge {
  from: string
  to: string
  label: string
}

export interface ChapterContent {
  chapter_id: string
  content: string
  chars: number
}

/** SSE 事件（GET /api/events，事件名 → data） */
export type AgentEvent =
  | { event: 'agent_start'; run_id: string; paper_title: string }
  | { event: 'tool_call'; run_id: string; tool: string; args: string; count: number }
  | { event: 'tool_result'; run_id: string; result: string }
  | { event: 'agent_message'; run_id: string; content: string }
  | { event: 'interrupt'; run_id: string; tool: string; reason: string; args: string }
  | { event: 'agent_complete'; run_id: string; tool_calls: number; chapters: Record<string, unknown> }
  | { event: 'agent_error'; run_id: string; error: string }

/** 右侧独占控制台的虚拟滚动 feed 条目 */
export interface FeedItem {
  id: number
  kind: AgentEvent['event']
  title: string
  sub?: string
  body?: string
  at: number
}
