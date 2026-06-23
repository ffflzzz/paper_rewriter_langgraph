import { Box, Text, useInput } from 'ink'
import React, { memo, useCallback, useState } from 'react'
import { theme } from '../lib/theme.js'

interface Props {
  onSubmit: (text: string) => void
  disabled: boolean
}

export const ComposerInput = memo(function ComposerInput({ onSubmit, disabled }: Props) {
  const [input, setInput] = useState('')

  useInput(
    (char, key) => {
      if (disabled) return

      if (key.return) {
        const trimmed = input.trim()
        if (trimmed) {
          onSubmit(trimmed)
          setInput('')
        }
        return
      }

      if (key.backspace || key.delete) {
        setInput(prev => prev.slice(0, -1))
        return
      }

      if (key.ctrl && char === 'c') {
        process.exit(0)
        return
      }

      // Regular character
      if (char && !key.ctrl && !key.meta) {
        setInput(prev => prev + char)
      }
    },
    { isActive: true },
  )

  return (
    <Box width="100%" paddingLeft={1} paddingRight={1}>
      <Text color={disabled ? theme.dimGreen : theme.green} bold>
        ▸{' '}
      </Text>
      <Text color={disabled ? theme.dimGreen : theme.white}>
        {disabled ? 'waiting…' : input || ''}
      </Text>
      {!disabled && input.length === 0 && (
        <Text color={theme.dimGreen}> type a message…</Text>
      )}
    </Box>
  )
})
