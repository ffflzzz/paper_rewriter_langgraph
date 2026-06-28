import React, { useState, useCallback, useEffect, useRef } from 'react'
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
import { createThread, getCurrentThreadId, setCurrentThreadId, listThreads, deleteThread, updateThreadMeta } from './lib/thread-store.js'

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
  const [sessionId, setSessionId] = useState(() => {
    const existing = getCurrentThreadId()
    if (existing) return existing
    return createThread()
  })
  const [threadList, setThreadList] = useState<ReturnType<typeof listThreads>>([])
  const [toolCalls, setToolCalls] = useState<ToolCallInfo[]>([])
  const [hitlPrompt, setHitlPrompt] = useState<HitlPromptData | null>(null)
  const [hitlCallback, setHitlCallback] = useState<((answer: string) => void) | null>(null)
  const [turnCount, setTurnCount] = useState(0)
  const streamingTextRef = useRef('')
  const [abortFn, setAbortFn] = useState<(() => void) | null>(null)
  const [startedAt] = useState(() => Date.now())
  const [inputReady, setInputReady] = useState(false)
  const [history, setHistory] = useState<string[]>(() => {
    // Load history from file on startup
    try {
      const { readFileSync } = require('fs')
      const { join } = require('path')
      const { homedir } = require('os')
      const historyFile = join(homedir(), '.rewriter', 'history.json')
      const data = readFileSync(historyFile, 'utf-8')
      return JSON.parse(data)
    } catch {
      return []
    }
  })
  const [historyIdx, setHistoryIdx] = useState(-1)

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
        content: `Paper Rewriter · ${config.model}\n\nCommands: /help · /new · /threads · /thread <id> · /quit\nType a message to chat.`,
        timestamp: Date.now(),
      }])
    }
  }, [config, showSetup])

  // Refresh thread list when switching
  const refreshThreads = useCallback(() => {
    setThreadList(listThreads())
  }, [])

  const handleSetupComplete = useCallback((newConfig: RewriterConfig) => {
    setConfig(newConfig)
    setShowSetup(false)
  }, [])

  useInput((input, key) => {
    if (!inputReady) return
    if (showSetup) return
    if (hitlPrompt) return

    // Up arrow — history previous
    if (key.upArrow) {
      if (history.length === 0) return
      const newIdx = historyIdx < 0 ? history.length - 1 : Math.max(0, historyIdx - 1)
      setHistoryIdx(newIdx)
      setInputText(history[newIdx])
      return
    }

    // Down arrow — history next
    if (key.downArrow) {
      if (historyIdx < 0) return
      const newIdx = historyIdx + 1
      if (newIdx >= history.length) {
        setHistoryIdx(-1)
        setInputText('')
      } else {
        setHistoryIdx(newIdx)
        setInputText(history[newIdx])
      }
      return
    }

    if (key.return) {
      const text = inputText.trim()
      if (!text) return

      // Save to history
      setHistory(prev => [...prev, text])
      setHistoryIdx(-1)

      if (text === '/quit') { exit(); return }
      if (text === '/help') {
        setMessages(prev => [...prev, { id: `h-${Date.now()}`, role: 'assistant', content: '/help    Show this help\n/new     New thread (conversation)\n/threads List all threads\n/thread <id> Switch to thread\n/del <id> Delete a thread\n/status  Show status\n/config  Reconfigure model\n/quit    Exit', timestamp: Date.now() }])
        setInputText('')
        return
      }
      if (text === '/new') {
        const newId = createThread()
        setSessionId(newId)
        setCurrentThreadId(newId)
        setMessages([])
        setToolCalls([])
        setTurnCount(0)
        refreshThreads()
        setInputText('')
        return
      }
      if (text === '/threads') {
        const threads = listThreads()
        if (threads.length === 0) {
          setMessages(prev => [...prev, { id: `t-${Date.now()}`, role: 'assistant', content: 'No threads yet.', timestamp: Date.now() }])
        } else {
          const lines = threads.map(t => {
            const marker = t.id === sessionId ? ' ●' : '  '
            const title = t.title || t.id.slice(0, 8)
            return `${marker} ${t.id.slice(0, 8)}... ${title} (${t.messageCount} msgs)`
          }).join('\n')
          setMessages(prev => [...prev, { id: `t-${Date.now()}`, role: 'assistant', content: `Threads (${threads.length}):\n${lines}`, timestamp: Date.now() }])
        }
        setInputText('')
        return
      }
      if (text.startsWith('/thread ')) {
        const targetId = text.slice(8).trim()
        if (!targetId) {
          setMessages(prev => [...prev, { id: `t-${Date.now()}`, role: 'assistant', content: 'Usage: /thread <id>', timestamp: Date.now() }])
          setInputText('')
          return
        }
        const threads = listThreads()
        const found = threads.find(t => t.id === targetId || t.id.startsWith(targetId))
        if (!found) {
          setMessages(prev => [...prev, { id: `t-${Date.now()}`, role: 'assistant', content: `Thread "${targetId}" not found. Use /threads to list.`, timestamp: Date.now() }])
          setInputText('')
          return
        }
        setSessionId(found.id)
        setCurrentThreadId(found.id)
        // Load messages from backend session store (best-effort)
        fetch(`http://localhost:8765/api/sessions/${found.id}/messages`)
          .then(r => r.ok ? r.json() : Promise.resolve({ messages: [] }))
          .then(data => {
            const loaded = (data.messages || []).map((m: any) => ({
              id: m.id,
              role: m.role as 'user' | 'assistant' | 'tool',
              content: m.content,
              toolName: m.tool_name || undefined,
              timestamp: m.timestamp * 1000,
            }))
            setMessages(loaded)
          })
          .catch(() => setMessages([]))
        setToolCalls([])
        setTurnCount(0)
        refreshThreads()
        setInputText('')
        return
      }
      if (text.startsWith('/del ')) {
        const targetId = text.slice(5).trim()
        if (!targetId) {
          setMessages(prev => [...prev, { id: `d-${Date.now()}`, role: 'assistant', content: 'Usage: /del <id>', timestamp: Date.now() }])
          setInputText('')
          return
        }
        const deleted = deleteThread(targetId)
        if (deleted) {
          const current = getCurrentThreadId()
          if (current) {
            setSessionId(current)
            setCurrentThreadId(current)
            setMessages([])
          }
          refreshThreads()
          setMessages(prev => [...prev, { id: `d-${Date.now()}`, role: 'assistant', content: `Thread ${targetId.slice(0, 8)}... deleted.`, timestamp: Date.now() }])
        } else {
          setMessages(prev => [...prev, { id: `d-${Date.now()}`, role: 'assistant', content: `Thread "${targetId}" not found.`, timestamp: Date.now() }])
        }
        setInputText('')
        return
      }
      if (text === '/status') {
        setMessages(prev => [...prev, { id: `s-${Date.now()}`, role: 'assistant', content: `model: ${config?.model || 'unknown'}\nthread: ${sessionId}\nmessages: ${messages.length}\nturns: ${turnCount}`, timestamp: Date.now() }])
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
    setStreamingText(''); streamingTextRef.current = ''
    setToolCalls([])

    // Persist user message to backend
    fetch('http://localhost:8765/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sessionId, title: text.slice(0, 50) }),
    }).catch(() => {})

    const abort = runAgent(
      [{ id: `m-${Date.now()}`, role: 'user', content: text }],
      sessionId,
      `run-${Date.now()}`,
      {
        onEvent: (event: AgUiEvent) => {
          const e = event as Record<string, unknown>
          switch (e.type) {
            case 'TEXT_MESSAGE_CONTENT':
              streamingTextRef.current += String(e.delta || '')
              setStreamingText(streamingTextRef.current)
              setStatus('streaming')
              break
            case 'TOOL_CALL_START':
              setToolCalls(prev => [...prev, { id: `tc-${Date.now()}`, name: String(e.toolCallName || e.name || '?'), args: String(e.args || ''), status: 'running' as const, startedAt: Date.now() }])
              break
            case 'TOOL_CALL_END':
              setToolCalls(prev => prev.map((tc, i) => i === prev.length - 1 ? { ...tc, status: 'done' as const } : tc))
              break
            case 'TOOL_CALL_RESULT':
              setToolCalls(prev => prev.map((tc, i) => i === prev.length - 1 ? { ...tc, result: String(e.content || '') } : tc))
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
          const text = streamingTextRef.current
          if (text) {
            setMessages(prev => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: text, timestamp: Date.now() }])
            // Persist assistant reply to backend
            fetch('http://localhost:8765/api/sessions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: sessionId, title: '' }),
            }).catch(() => {})
            updateThreadMeta(sessionId, { messageCount: 0 })
            refreshThreads()
          }
          streamingTextRef.current = ''
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
        sessionId={sessionId.slice(0, 8)}
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
