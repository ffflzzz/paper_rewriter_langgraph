import { Box, Text } from 'ink'
import React, { memo } from 'react'
import { theme } from '../lib/theme.js'
import type { ToolCallInfo } from '../lib/types.js'

interface Props {
  toolCalls: ToolCallInfo[]
}

export const ToolCallCards = memo(function ToolCallCards({ toolCalls }: Props) {
  if (toolCalls.length === 0) return null

  return (
    <Box flexDirection="column" paddingLeft={1}>
      {toolCalls.map(tc => (
        <Box key={tc.id} flexDirection="column">
          <Box>
            <Text color={theme.yellow}>🔧 </Text>
            <Text color={theme.yellow} bold>{tc.name}</Text>
          </Box>
          {tc.status === 'done' && tc.result && (
            <Box paddingLeft={3}>
              <Text color={theme.dimGreen}>
                {tc.result.length > 120 ? tc.result.slice(0, 120) + '…' : tc.result}
              </Text>
            </Box>
          )}
        </Box>
      ))}
    </Box>
  )
})
