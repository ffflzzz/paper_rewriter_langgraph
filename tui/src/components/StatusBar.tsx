import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import { theme } from '../lib/theme.js'

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

  useEffect(() => {
    const timer = setInterval(() => {
      if (startedAt) {
        const mins = Math.floor((Date.now() - startedAt) / 60000)
        const hrs = Math.floor(mins / 60)
        const m = mins % 60
        setElapsed(hrs > 0 ? `${hrs}h ${m}m` : `${m}m`)
      }
    }, 10000)
    return () => clearInterval(timer)
  }, [startedAt])

  const statusIcon = status === 'idle' ? '◇' : status === 'processing' ? '●' : status === 'streaming' ? '▸' : '✗'
  const statusColor = status === 'error' ? theme.red : status === 'idle' ? theme.dimGreen : theme.green

  return (
    <Box paddingX={1} justifyContent="space-between">
      {/* Left: status */}
      <Box>
        <Text color={theme.green}>▸ </Text>
        <Text color={statusColor}>{statusIcon} {status === 'idle' ? 'ready' : status === 'processing' ? 'processing...' : status === 'streaming' ? 'streaming...' : 'error'}</Text>
      </Box>

      {/* Right: model + tools + turns + duration + session */}
      <Box>
        <Text color={theme.dimGreen}>{model}</Text>
        <Text color={theme.dimGreen}> │ </Text>
        <Text color={theme.dimGreen}>tools:{toolCount}</Text>
        <Text color={theme.dimGreen}> │ </Text>
        <Text color={theme.dimGreen}>turns:{turnCount}</Text>
        <Text color={theme.dimGreen}> │ </Text>
        <Text color={theme.dimGreen}>{elapsed}</Text>
        <Text color={theme.dimGreen}> │ </Text>
        <Text color={theme.dimGreen}>{sessionId}</Text>
      </Box>
    </Box>
  )
}
