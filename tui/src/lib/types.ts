// AG-UI event types
export type AgUiEventType =
  | 'RUN_STARTED'
  | 'RUN_FINISHED'
  | 'RUN_ERROR'
  | 'STEP_STARTED'
  | 'STEP_FINISHED'
  | 'TEXT_MESSAGE_START'
  | 'TEXT_MESSAGE_CONTENT'
  | 'TEXT_MESSAGE_END'
  | 'TOOL_CALL_START'
  | 'TOOL_CALL_ARGS'
  | 'TOOL_CALL_END'
  | 'TOOL_CALL_RESULT'
  | 'STATE_SNAPSHOT'
  | 'STATE_DELTA'
  | 'MESSAGES_SNAPSHOT'
  | 'CUSTOM'
  | 'RAW'

export interface AgUiEvent {
  type: AgUiEventType
  messageId?: string
  toolCallId?: string
  toolCallName?: string
  delta?: string
  content?: string
  role?: string
  name?: string
  args?: string
  snapshot?: Record<string, unknown>
  state?: Record<string, unknown>
  messages?: AgUiMessage[]
  rawEvent?: Record<string, unknown>
  customEvent?: Record<string, unknown>
  error?: string
  [key: string]: unknown
}

export interface AgUiMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content?: string
  toolCallId?: string
  toolCalls?: AgUiToolCall[]
}

export interface AgUiToolCall {
  id: string
  name: string
  arguments?: string
}

// Transcript message types
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export interface TranscriptMessage {
  id: string
  role: MessageRole
  content: string
  timestamp: number
  toolName?: string
  toolCallId?: string
  isStreaming?: boolean
}

export interface ToolCallInfo {
  id: string
  name: string
  args: string
  status: 'running' | 'done'
  result?: string
}

export interface HitlPromptData {
  message: string
  options: string[]
  toolName?: string
}

export interface SessionInfo {
  sessionId: string
  status: string
  messageCount: number
  toolCallCount: number
  turnCount: number
  startedAt: number
}

// RunAgentInput for AG-UI
export interface RunAgentInput {
  threadId: string
  runId: string
  state: Record<string, unknown>
  messages: Array<{
    id: string
    role: string
    content: string
  }>
}
