import { Box, Text, useInput } from 'ink'
import React, { memo } from 'react'
import { theme } from '../lib/theme.js'
import type { HitlPromptData } from '../lib/types.js'

interface Props {
  prompt: HitlPromptData
  onAnswer: (answer: string) => void
}

export const HitlPrompt = memo(function HitlPrompt({ prompt, onAnswer }: Props) {
  useInput((input, key) => {
    if (key.return || input === 'y') {
      onAnswer('y')
    } else if (input === 'n') {
      onAnswer('n')
    } else if (input === 's') {
      onAnswer('skip')
    }
  })

  return (
    <Box flexDirection="column" paddingLeft={1} marginTop={1}>
      <Box>
        <Text color={theme.yellow}>⚠ </Text>
        <Text color={theme.yellow} bold>CONFIRM</Text>
        <Text color={theme.dimGreen}> │ </Text>
        <Text color={theme.white}>{prompt.toolName || 'action'}</Text>
        {prompt.message && (
          <>
            <Text color={theme.dimGreen}> │ </Text>
            <Text color={theme.dimGreen}>{prompt.message.length > 80 ? prompt.message.slice(0, 80) + '…' : prompt.message}</Text>
          </>
        )}
      </Box>
      <Box>
        <Text color={theme.green}>y</Text>
        <Text color={theme.dimGreen}>/yes · </Text>
        <Text color={theme.red}>n</Text>
        <Text color={theme.dimGreen}>/no · </Text>
        <Text color={theme.dimWhite}>skip</Text>
      </Box>
    </Box>
  )
})
