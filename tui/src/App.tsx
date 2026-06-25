import React, { useState, useCallback, useEffect } from 'react'
import { Box, Text, useInput, useApp } from 'ink'
import { theme } from './lib/theme.js'
import { runAgent } from './lib/agui-client.js'
import { loadConfig, type RewriterConfig } from './lib/config.js'
import type { AgUiEvent, ToolCallInfo, HitlPromptData } from './lib/types.js'
import { TranscriptPane } from './components/TranscriptPane.js'
import { StatusBar } from './components/StatusBar.js'
import { ToolCallCards } from './components/ToolCallCards.js'
import { HitlPrompt } from './components/HitlPrompt.js'
import { SetupWizard } from './components/SetupWizard.js'

interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolName?: string
  timestamp: number
}

export function App() {
  const { exit } = useApp()
  const [config, setConfig] = useState<RewriterConfig | null>(() => loadConfig())
  const [showSetup, setShowSetup] = useState(!config)
  const [messages, setMessages] = useState<Message[]>([])
  const [inputText, setInputText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [status, setStatus] = useState<'idle' | 'processing' | 'streaming' | 'error'>('idle')
  const [sessionId] = useState(() => `local-${Date.now() % 100000}`)
  const [toolCalls, setToolCalls] = useState<ToolCallInfo[]>([])
  const [hitlPrompt, setHitlPrompt] = useState<HitlPromptData | null>(null)
  const [hitlCallback, setHitlCallback] = useState<((answer: string) => void) | null>(null)
  const [turnCount, setTurnCount] = useState(0)
  const [abortFn, setAbortFn] = useState<(() => void) | null>(null)
  const [startedAt] = useState(() => Date.now())
  const [inputReady, setInputReady] = useState(false)

  // Delay input capture to avoid capturing the launch command
  useEffect(() => {
    const timer = setTimeout(() => setInputReady(true), 500)
    return () => clearTimeout(timer)
  }, [])

  // Show welcome message after setup
  useEffect(() => {
    if (config && !showSetup) {
      setMessages([{
        id: 'welcome',
        role: 'assistant',
        content: `Paper Rewriter · ${config.model}\n\nType a message to chat. Commands: /help · /new · /status · /quit`,
        timestamp: Date.now(),
      }])
    }
  }, [config, showSetup])

  const handleSetupComplete = useCallback((newConfig: RewriterConfig) => {
    setConfig(newConfig)
    setShowSetup(false)
  }, [])

  useInput((input, key) => {
    if (!inputReady) return
    if (showSetup) return
    if (hitlPrompt) return

    if (key.return) {
      const text = inputText.trim()
      if (!text) return

      if (text === '/quit') { exit(); return }
      if (text === '/help') {
        setMessages(prev => [...prev, { id: `h-${Date.now()}`, role: 'assistant', content: '/help    Show this help\n/new     New session\n/status  Show status\n/config  Reconfigure model\n/quit    Exit', timestamp: Date.now() }])
        setInputText('')
        return
      }
      if (text === '/new') {
        setMessages([]); setToolCalls([]); setTurnCount(0); setInputText('')
        return
      }
      if (text === '/status') {
        setMessages(prev => [...prev, { id: `s-${Date.now()}`, role: 'assistant', content: `model: ${config?.model || 'unknown'}\nsession: ${sessionId}\nmessages: ${messages.length}\nturns: ${turnCount}`, timestamp: Date.now() }])
        setInputText('')
        return
      }
      if (text === '/config') {
        setShowSetup(true)
        setInputText('')
        return
      }
      sendMessage(text)
      setInputText('')
      return
    }

    if (key.backspace || key.delete) {
      setInputText(prev => prev.slice(0, -1))
      return
    }

    if (key.escape && isStreaming && abortFn) {
      abortFn()
      return
    }

    if (input && !key.ctrl && !key.meta) {
      setInputText(prev => prev + input)
    }
  })

  const sendMessage = useCallback((text: string) => {
    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: text, timestamp: Date.now() }
    setMessages(prev => [...prev, userMsg])
    setTurnCount(prev => prev + 1)
    setStatus('processing')
    setIsStreaming(true)
    setStreamingText('')
    setToolCalls([])

    const abort = runAgent(
      [{ id: `m-${Date.now()}`, role: 'user', content: text }],
      sessionId,
      `run-${Date.now()}`,
      {
        onEvent: (event: AgUiEvent) => {
          const e = event as Record<string, unknown>
          switch (e.type) {
            case 'TEXT_MESSAGE_CONTENT':
              setStreamingText(prev => prev + String(e.delta || ''))
              setStatus('streaming')
              break
            case 'TOOL_CALL_START':
              setToolCalls(prev => [...prev, { id: `tc-${Date.now()}`, name: String(e.toolCallName || e.name || '?'), args: String(e.args || ''), status: 'running' as const }])
              break
            case 'TOOL_CALL_END':
              setToolCalls(prev => prev.map((tc, i) => i === prev.length - 1 ? { ...tc, status: 'done' as const, result: String(e.content || e.result || '') } : tc))
              break
            case 'STEP_STARTED':
              setStatus('processing')
              break
          }
        },
        onError: (err: Error) => {
          setStatus('error')
          setIsStreaming(false)
          setMessages(prev => [...prev, { id: `e-${Date.now()}`, role: 'assistant', content: `Error: ${err.message}`, timestamp: Date.now() }])
        },
        onDone: () => {
          setStreamingText(current => {
            if (current) {
              setMessages(prev => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: current, timestamp: Date.now() }])
            }
            return ''
          })
          setIsStreaming(false)
          setStatus('idle')
        },
      },
    )
    setAbortFn(() => abort)
  }, [sessionId, config])

  // Setup wizard
  if (showSetup) {
    return <SetupWizard onComplete={handleSetupComplete} />
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Transcript — messages above input */}
      <TranscriptPane messages={messages} streamingText={streamingText} isStreaming={isStreaming} />

      {/* Tool call cards */}
      {toolCalls.length > 0 && <ToolCallCards toolCalls={toolCalls} />}

      {/* HITL prompt */}
      {hitlPrompt && hitlCallback && <HitlPrompt prompt={hitlPrompt} onAnswer={hitlCallback} />}

      {/* Input — wrapped box */}
      <Box flexDirection="column">
        <Text color={theme.burgundy}>{'┌─ Input ' + '─'.repeat(Math.max(0, (process.stdout.columns || 80) - 11)) + '┐'}</Text>
        <Box>
          <Text color={theme.burgundy}>│ </Text>
          <Text color={theme.green} bold>{'▸ '}</Text>
          <Text color={theme.white}>{inputText}</Text>
          <Text color={theme.dimGreen}>{'▌'}</Text>
        </Box>
        <Text color={theme.burgundy}>{'└' + '─'.repeat(Math.max(0, (process.stdout.columns || 80) - 3)) + '┘'}</Text>
      </Box>

      {/* Status bar */}
      <StatusBar
        status={status}
        toolCount={toolCalls.length}
        turnCount={turnCount}
        sessionId={sessionId}
        model={config?.model || 'unknown'}
        startedAt={startedAt}
      />

      {/* Status rule — separator at very bottom */}
      <Box>
        <Text color={theme.burgundy}>{'─'.repeat(process.stdout.columns || 80)}</Text>
      </Box>
    </Box>
  )
}
