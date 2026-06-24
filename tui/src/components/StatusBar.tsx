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
}

export function StatusBar({ status, toolCount, turnCount, sessionId, model = 'mimo-v2.5-pro', startedAt }: Props) {
  const [elapsed, setElapsed] = useState('0m')
  const [spinnerIdx, setSpinnerIdx] = useState(0)

  useEffect(() => {
    const update = () => {
      if (startedAt) {
        const mins = Math.floor((Date.now() - startedAt) / 60000)
        const hrs = Math.floor(mins / 60)
        const m = mins % 60
        setElapsed(hrs > 0 ? `${hrs}h ${m}m` : `${m}m`)
      }
    }
    update()
    const timer = setInterval(update, 10000)
    return () => clearInterval(timer)
  }, [startedAt])

  // Spinner animation during streaming
  useEffect(() => {
    if (status !== 'streaming') return
    const timer = setInterval(() => {
      setSpinnerIdx(i => (i + 1) % SPINNER_FRAMES.length)
    }, 80)
    return () => clearInterval(timer)
  }, [status])

  // Hermes format: ⚕ model · [status] · duration
  const statusText = status === 'streaming'
    ? 'streaming...'
    : status === 'processing'
      ? 'processing...'
      : null

  return (
    <Box paddingX={1}>
      <Text color={theme.green}>⚕ </Text>
      <Text color={theme.dimGreen}>{model}</Text>
      {statusText && (
        <>
          <Text color={theme.dimGreen}> · </Text>
          {status === 'streaming' && (
            <Text color={theme.green}>{SPINNER_FRAMES[spinnerIdx]} </Text>
          )}
          <Text color={theme.dimGreen}>{statusText}</Text>
        </>
      )}
      <Text color={theme.dimGreen}> · {elapsed}</Text>
    </Box>
  )
}
