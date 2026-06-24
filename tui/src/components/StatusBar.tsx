import React from 'react'
import { Box, Text } from 'ink'
import { theme } from '../lib/theme.js'

interface Props {
  status: string
  toolCount: number
  turnCount: number
  sessionId: string
}

export function StatusBar({ status, toolCount, turnCount, sessionId }: Props) {
  const statusIcon = status === 'idle' ? '◇' : status === 'processing' ? '●' : status === 'streaming' ? '▸' : '✗'
  const statusText = status === 'idle' ? 'ready' : status === 'processing' ? 'processing...' : status === 'streaming' ? 'streaming...' : 'error'

  const left = `${statusIcon} ${statusText}`
  const right = `tools:${toolCount} │ turns:${turnCount} │ ${sessionId}`

  return (
    <Box paddingX={1}>
      <Text color={theme.dimGreen}>
        {'▸'}{' '}
      </Text>
      <Text color={status === 'error' ? theme.red : theme.dimGreen}>
        {left}
      </Text>
      <Text color={theme.dimGreen}>
        {' '.repeat(Math.max(1, (process.stdout.columns || 80) - left.length - right.length - 4))}
      </Text>
      <Text color={theme.dimGreen}>
        {right}
      </Text>
    </Box>
  )
}
