import { Box, Text } from 'ink'
import React, { memo } from 'react'
import { theme } from '../lib/theme.js'

interface Props {
  sessionId: string
  status: string
  toolCallCount: number
  turnCount: number
}

export const StatusBar = memo(function StatusBar({
  sessionId,
  status,
  toolCallCount,
  turnCount,
}: Props) {
  const statusColor =
    status === 'streaming'
      ? theme.green
      : status === 'error'
        ? theme.red
        : status === 'idle'
          ? theme.dimGreen
          : theme.dimWhite

  return (
    <Box
      width="100%"
      paddingLeft={1}
      paddingRight={1}
    >
      <Text color={theme.dimGreen}>▸ </Text>
      <Text color={statusColor}>{status}</Text>
      <Text color={theme.dimGreen}>{' '.repeat(Math.max(1, 40 - status.length))}</Text>
      <Text color={theme.dimGreen}>
        tools:{toolCallCount} │ turns:{turnCount} │ {sessionId}
      </Text>
    </Box>
  )
})
