import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import { theme } from '../lib/theme.js'

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

interface Props {
  status: string
  toolCount: number
  turnCount: number
  sessionId: string
  model?: string
  startedAt?: number
  tokenCount?: number
  maxTokens?: number
}

export function StatusBar({ status, toolCount, turnCount, sessionId, model = 'mimo-v2.5-pro', startedAt, tokenCount = 0, maxTokens = 128000 }: Props) {
  const [tick, setTick] = useState(0)
  const [spinnerIdx, setSpinnerIdx] = useState(0)

  // Force re-render every 10s to update elapsed time
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  // Spinner animation during streaming
  useEffect(() => {
    if (status !== 'streaming') return
    const timer = setInterval(() => {
      setSpinnerIdx(i => (i + 1) % SPINNER_FRAMES.length)
    }, 80)
    return () => clearInterval(timer)
  }, [status])

  // Calculate elapsed time
  const elapsed = startedAt ? (() => {
    const mins = Math.floor((Date.now() - startedAt) / 60000)
    const hrs = Math.floor(mins / 60)
    const m = mins % 60
    return hrs > 0 ? `${hrs}h ${m}m` : `${m}m`
  })() : '0m'

  // Context window usage percentage
  const ctxPct = maxTokens > 0 ? Math.round((tokenCount / maxTokens) * 100) : 0

  return (
    <Box paddingX={1}>
      <Text color={theme.burgundy}>⚕ </Text>
      <Text color={theme.dimBurgundy}>{model}</Text>
      {status !== 'idle' && (
        <>
          <Text color={theme.dimBurgundy}> · </Text>
          {status === 'streaming' && <Text color={theme.burgundy}>{SPINNER_FRAMES[spinnerIdx]} </Text>}
          <Text color={theme.dimBurgundy}>{status}</Text>
        </>
      )}
      <Text color={theme.dimBurgundy}> · </Text>
      <Text color={theme.dimBurgundy}>⚙ {toolCount}</Text>
      <Text color={theme.dimBurgundy}> · </Text>
      <Text color={theme.dimBurgundy}>{elapsed}</Text>
      {tokenCount > 0 && (
        <>
          <Text color={theme.dimBurgundy}> · </Text>
          <Text color={theme.dimBurgundy}>ctx {ctxPct}%</Text>
        </>
      )}
    </Box>
  )
}
