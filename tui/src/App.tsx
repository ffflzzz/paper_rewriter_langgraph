/**
 * App.tsx — Main Paper Rewriter TUI layout.
 *
 * Layout (top to bottom):
 *   Header bar
 *   Transcript pane (scrollable)
 *   Separator
 *   Tool call cards
 *   HITL prompt (when active)
 *   Composer input
 *   Status bar
 */

import { Box, Text, useApp, useInput, useStdout } from 'ink'
import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { ComposerInput } from './components/ComposerInput.js'
import { HitlPrompt } from './components/HitlPrompt.js'
import { StatusBar } from './components/StatusBar.js'
import { ToolCallCards } from './components/ToolCallCards.js'
import { TranscriptPane } from './components/TranscriptPane.js'
import { runAgent, fetchStatus } from './lib/agui-client.js'
import { theme } from './lib/theme.js'
import type {
  AgUiEvent,
  HitlPromptData,
  ToolCallInfo,
  TranscriptMessage,
} from './lib/types.js'

// ── State ──

interface AppState {
  messages: TranscriptMessage[]
  streamingText: string
  isStreaming: boolean
  toolCalls: ToolCallInfo[]
  hitlPrompt: HitlPromptData | null
  sessionId: string
  status: string
  toolCallCount: number
  turnCount: number
  threadId: string
  error: string | null
}

type Action =
  | { type: 'ADD_MESSAGE'; message: TranscriptMessage }
  | { type: 'SET_STREAMING'; text: string }
  | { type: 'STOP_STREAMING' }
  | { type: 'APPEND_STREAMING'; delta: string }
  | { type: 'TOOL_CALL_START'; toolCall: ToolCallInfo }
  | { type: 'TOOL_CALL_UPDATE'; id: string; args: string }
  | { type: 'TOOL_CALL_END'; id: string; result?: string }
  | { type: 'SET_HITL'; prompt: HitlPromptData | null }
  | { type: 'SET_STATUS'; status: string }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'INCREMENT_TURN' }
  | { type: 'NEW_SESSION' }
  | { type: 'CLEAR_STREAMING' }

function genId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function genSessionId(): string {
  return `tui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function createInitialState(): AppState {
  return {
    messages: [],
    streamingText: '',
    isStreaming: false,
    toolCalls: [],
    hitlPrompt: null,
    sessionId: genSessionId(),
    status: 'idle',
    toolCallCount: 0,
    turnCount: 0,
    threadId: genId(),
    error: null,
  }
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'ADD_MESSAGE':
      return {
        ...state,
        messages: [...state.messages, action.message],
      }
    case 'SET_STREAMING':
      return {
        ...state,
        isStreaming: true,
        streamingText: action.text,
        status: 'streaming',
      }
    case 'APPEND_STREAMING':
      return {
        ...state,
        streamingText: state.streamingText + action.delta,
      }
    case 'STOP_STREAMING': {
      const msgs = state.streamingText
        ? [
            ...state.messages,
            {
              id: genId(),
              role: 'assistant' as const,
              content: state.streamingText,
              timestamp: Date.now(),
            },
          ]
        : state.messages
      return {
        ...state,
        messages: msgs,
        isStreaming: false,
        streamingText: '',
        status: 'idle',
      }
    }
    case 'CLEAR_STREAMING':
      return { ...state, isStreaming: false, streamingText: '' }
    case 'TOOL_CALL_START':
      return {
        ...state,
        toolCalls: [...state.toolCalls, action.toolCall],
        toolCallCount: state.toolCallCount + 1,
      }
    case 'TOOL_CALL_UPDATE':
      return {
        ...state,
        toolCalls: state.toolCalls.map(tc =>
          tc.id === action.id ? { ...tc, args: tc.args + action.args } : tc,
        ),
      }
    case 'TOOL_CALL_END':
      return {
        ...state,
        toolCalls: state.toolCalls.map(tc =>
          tc.id === action.id
            ? { ...tc, status: 'done' as const, result: action.result ?? tc.result }
            : tc,
        ),
      }
    case 'SET_HITL':
      return { ...state, hitlPrompt: action.prompt }
    case 'SET_STATUS':
      return { ...state, status: action.status }
    case 'SET_ERROR':
      return { ...state, error: action.error, status: 'error' }
    case 'INCREMENT_TURN':
      return { ...state, turnCount: state.turnCount + 1 }
    case 'NEW_SESSION': {
      const newId = genSessionId()
      return {
        ...createInitialState(),
        sessionId: newId,
        messages: [
          {
            id: genId(),
            role: 'system',
            content: `New session: ${newId}`,
            timestamp: Date.now(),
          },
        ],
      }
    }
    default:
      return state
  }
}

// ── Commands ──

function handleCommand(
  cmd: string,
  state: AppState,
  dispatch: React.Dispatch<Action>,
): boolean {
  const lower = cmd.toLowerCase().trim()

  if (lower === '/quit' || lower === '/exit') {
    process.exit(0)
  }

  if (lower === '/help') {
    dispatch({
      type: 'ADD_MESSAGE',
      message: {
        id: genId(),
        role: 'system',
        content:
          'Commands:\n' +
          '  /help    — Show this help\n' +
          '  /new     — New session\n' +
          '  /status  — Show session status\n' +
          '  /clear   — Clear transcript\n' +
          '  /quit    — Exit TUI',
        timestamp: Date.now(),
      },
    })
    return true
  }

  if (lower === '/new') {
    dispatch({ type: 'NEW_SESSION' })
    return true
  }

  if (lower === '/status') {
    dispatch({
      type: 'ADD_MESSAGE',
      message: {
        id: genId(),
        role: 'system',
        content: [
          `Session  : ${state.sessionId}`,
          `Thread   : ${state.threadId}`,
          `Messages : ${state.messages.length}`,
          `Tool calls: ${state.toolCallCount}`,
          `Turns    : ${state.turnCount}`,
          `Status   : ${state.status}`,
        ].join('\n'),
        timestamp: Date.now(),
      },
    })
    return true
  }

  if (lower === '/clear') {
    // Reset messages but keep session
    dispatch({ type: 'NEW_SESSION' })
    return true
  }

  return false
}

// ── App ──

export function App() {
  const [state, dispatch] = useReducer(reducer, null, createInitialState)
  const abortRef = useRef<(() => void) | null>(null)
  const [connected, setConnected] = useState(false)

  // Enter alternate screen on mount
  const { stdout } = useStdout()
  useEffect(() => {
    // Enter alternate screen + hide cursor
    stdout.write('\x1b[?1049h')
    stdout.write('\x1b[?25l')

    // Check backend connectivity
    fetchStatus()
      .then(() => {
        setConnected(true)
        dispatch({
          type: 'ADD_MESSAGE',
          message: {
            id: genId(),
            role: 'system',
            content:
              '📝 PAPER REWRITER — TypeScript Ink TUI\n' +
              'Connected to AG-UI backend at localhost:8765\n' +
              'Type your message to chat. Commands: /help · /new · /status · /quit',
            timestamp: Date.now(),
          },
        })
      })
      .catch(() => {
        setConnected(false)
        dispatch({
          type: 'ADD_MESSAGE',
          message: {
            id: genId(),
            role: 'system',
            content:
              '📝 PAPER REWRITER — TypeScript Ink TUI\n' +
              '⚠ Backend not reachable at localhost:8765\n' +
              'Start the backend: cd /home/lex/paper_rewriter_langgraph && python3 -m agent.server_agui\n' +
              'Commands: /help · /new · /status · /quit',
            timestamp: Date.now(),
          },
        })
      })

    return () => {
      // Leave alternate screen + show cursor
      stdout.write('\x1b[?25h')
      stdout.write('\x1b[?1049l')
    }
  }, [])

  // Handle AG-UI events
  const handleEvent = useCallback(
    (event: AgUiEvent) => {
      switch (event.type) {
        case 'RUN_STARTED':
          dispatch({ type: 'SET_STATUS', status: 'streaming' })
          break

        case 'TEXT_MESSAGE_START':
          dispatch({ type: 'SET_STREAMING', text: '' })
          break

        case 'TEXT_MESSAGE_CONTENT':
          if (event.delta) {
            dispatch({ type: 'APPEND_STREAMING', delta: event.delta })
          }
          break

        case 'TEXT_MESSAGE_END':
          dispatch({ type: 'STOP_STREAMING' })
          dispatch({ type: 'INCREMENT_TURN' })
          break

        case 'TOOL_CALL_START':
          dispatch({
            type: 'TOOL_CALL_START',
            toolCall: {
              id: event.toolCallId || genId(),
              name: event.toolCallName || event.name || 'unknown',
              args: '',
              status: 'running',
            },
          })
          break

        case 'TOOL_CALL_ARGS':
          if (event.toolCallId && event.delta) {
            dispatch({
              type: 'TOOL_CALL_UPDATE',
              id: event.toolCallId,
              args: event.delta,
            })
          }
          break

        case 'TOOL_CALL_END':
          dispatch({
            type: 'TOOL_CALL_END',
            id: event.toolCallId || '',
          })
          break

        case 'RUN_FINISHED':
          dispatch({ type: 'SET_STATUS', status: 'idle' })
          if (state.isStreaming && state.streamingText) {
            dispatch({ type: 'STOP_STREAMING' })
          }
          // Clear completed tool calls after a delay
          setTimeout(() => {
            dispatch({ type: 'CLEAR_STREAMING' })
          }, 100)
          break

        case 'RUN_ERROR':
          dispatch({
            type: 'SET_ERROR',
            error: event.error || 'Unknown error',
          })
          dispatch({ type: 'CLEAR_STREAMING' })
          break

        case 'STATE_SNAPSHOT':
        case 'STATE_DELTA':
        case 'MESSAGES_SNAPSHOT':
          // State events — we don't need to display these
          break

        case 'STEP_STARTED':
        case 'STEP_FINISHED':
          // Step lifecycle — informational
          break

        case 'CUSTOM':
          // Custom events from the agent
          break

        default:
          break
      }
    },
    [state.isStreaming, state.streamingText],
  )

  const handleSendMessage = useCallback(
    (text: string) => {
      // Handle commands
      if (text.startsWith('/')) {
        handleCommand(text, state, dispatch)
        return
      }

      if (!connected) {
        dispatch({
          type: 'ADD_MESSAGE',
          message: {
            id: genId(),
            role: 'system',
            content: '⚠ Not connected to backend. Start the Python server first.',
            timestamp: Date.now(),
          },
        })
        return
      }

      // Abort any existing run
      if (abortRef.current) {
        abortRef.current()
        abortRef.current = null
      }

      // Add user message to transcript
      dispatch({
        type: 'ADD_MESSAGE',
        message: {
          id: genId(),
          role: 'user',
          content: text,
          timestamp: Date.now(),
        },
      })

      dispatch({ type: 'SET_STATUS', status: 'sending' })

      // Build messages array for AG-UI
      const agMessages = state.messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
        }))
        .concat([{ id: genId(), role: 'user', content: text }])

      const runId = genId()

      abortRef.current = runAgent(agMessages, state.threadId, runId, {
        onEvent: handleEvent,
        onError: (err) => {
          dispatch({ type: 'SET_ERROR', error: err.message })
          dispatch({ type: 'CLEAR_STREAMING' })
        },
        onDone: () => {
          if (state.isStreaming) {
            dispatch({ type: 'STOP_STREAMING' })
          }
          dispatch({ type: 'SET_STATUS', status: 'idle' })
        },
      })
    },
    [state, connected, handleEvent],
  )

  const handleHitlAnswer = useCallback((answer: string) => {
    dispatch({ type: 'SET_HITL', prompt: null })
    // Send the HITL answer as a user message
    // Use a timeout to avoid calling handleSendMessage during render
    setTimeout(() => {
      // We need to call handleSendMessage, but it's defined after this callback
      // So we'll dispatch the message directly and trigger the agent
      dispatch({
        type: 'ADD_MESSAGE',
        message: {
          id: genId(),
          role: 'user',
          content: answer,
          timestamp: Date.now(),
        },
      })

      // Build messages for AG-UI
      const agMessages = [
        { id: genId(), role: 'user' as const, content: answer },
      ]

      dispatch({ type: 'SET_STATUS', status: 'sending' })

      const runId = genId()
      abortRef.current = runAgent(agMessages, state.threadId, runId, {
        onEvent: handleEvent,
        onError: (err) => {
          dispatch({ type: 'SET_ERROR', error: err.message })
          dispatch({ type: 'CLEAR_STREAMING' })
        },
        onDone: () => {
          dispatch({ type: 'SET_STATUS', status: 'idle' })
        },
      })
    }, 0)
  }, [state.threadId, handleEvent])

  // Global key handler
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (abortRef.current) abortRef.current()
      process.exit(0)
    }
    if (key.ctrl && input === 'l') {
      // Clear screen — just reset messages
      dispatch({ type: 'NEW_SESSION' })
    }
  })

  return (
    <Box flexDirection="column" width="100%" height="100%">
      {/* Header */}
      <Box paddingLeft={1} paddingRight={1}>
        <Text color={theme.green} bold>
          {' '}📝 PAPER REWRITER{' '}
        </Text>
        <Text color={theme.dimGreen}>│</Text>
        <Text color={theme.dimGreen}>
          {' '}Session:{' '}
        </Text>
        <Text color={theme.green}>{state.sessionId}</Text>
        <Text color={theme.dimGreen}>
          {' '}│{' '}tools:{state.toolCallCount}{' '}│{' '}turns:{state.turnCount}
        </Text>
        <Text color={theme.dimGreen}>
          {' '}│{' '}
        </Text>
        <Text color={connected ? theme.green : theme.red}>
          {connected ? '● connected' : '○ disconnected'}
        </Text>
      </Box>

      {/* Separator */}
      <Box>
        <Text color={theme.dimGreen}>{'─'.repeat(80)}</Text>
      </Box>

      {/* Transcript */}
      <TranscriptPane
        messages={state.messages}
        streamingText={state.streamingText}
        isStreaming={state.isStreaming}
      />

      {/* Tool calls */}
      <ToolCallCards toolCalls={state.toolCalls} />

      {/* HITL prompt */}
      {state.hitlPrompt && (
        <HitlPrompt prompt={state.hitlPrompt} onAnswer={handleHitlAnswer} />
      )}

      {/* Error display */}
      {state.error && (
        <Box paddingLeft={1} paddingRight={1}>
          <Text color={theme.red}>⚠ {state.error}</Text>
        </Box>
      )}

      {/* Separator */}
      <Box>
        <Text color={theme.dimGreen}>{'─'.repeat(80)}</Text>
      </Box>

      {/* Composer input */}
      <ComposerInput
        onSubmit={handleSendMessage}
        disabled={state.isStreaming}
      />

      {/* Status bar */}
      <StatusBar
        sessionId={state.sessionId}
        status={state.status}
        toolCallCount={state.toolCallCount}
        turnCount={state.turnCount}
      />
    </Box>
  )
}
