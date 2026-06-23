import { Box, Text, useInput } from 'ink'
import React, { memo, useState } from 'react'
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
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.yellow}
      paddingLeft={1}
      paddingRight={1}
      marginTop={1}
    >
      <Text color={theme.yellow} bold>
        ⚡ HITL Confirmation
      </Text>
      <Text color={theme.white}>{prompt.message}</Text>
      <Box marginTop={1}>
        <Text color={theme.green} bold>
          [y]
        </Text>
        <Text color={theme.dimGreen}>es </Text>
        <Text color={theme.red} bold>
          [n]
        </Text>
        <Text color={theme.dimGreen}>o </Text>
        <Text color={theme.dimWhite} bold>
          [s]
        </Text>
        <Text color={theme.dimGreen}>kip</Text>
      </Box>
    </Box>
  )
})
