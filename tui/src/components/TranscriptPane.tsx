import { Box, Text } from 'ink'
import React, { memo, useEffect, useRef } from 'react'
import { theme } from '../lib/theme.js'
import type { TranscriptMessage } from '../lib/types.js'

interface Props {
  messages: TranscriptMessage[]
  streamingText: string
  isStreaming: boolean
}

function messageColor(role: string): string {
  switch (role) {
    case 'user':
      return theme.cyan
    case 'assistant':
      return theme.green
    case 'system':
      return theme.dimGreen
    case 'tool':
      return theme.yellow
    default:
      return theme.dimWhite
  }
}

function messagePrefix(role: string): string {
  switch (role) {
    case 'user':
      return '▸ '
    case 'assistant':
      return '│ '
    case 'system':
      return '◦ '
    case 'tool':
      return '⚙ '
    default:
      return '  '
  }
}

function wrapText(text: string, width: number): string[] {
  if (!text) return ['']
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (!paragraph) {
      lines.push('')
      continue
    }
    const words = paragraph.split(/\s+/)
    let current = ''
    for (const word of words) {
      if (current && current.length + 1 + word.length > width) {
        lines.push(current)
        current = word
      } else {
        current = current ? `${current} ${word}` : word
      }
    }
    if (current) lines.push(current)
  }
  return lines.length ? lines : ['']
}

export const TranscriptPane = memo(function TranscriptPane({
  messages,
  streamingText,
  isStreaming,
}: Props) {
  const containerRef = useRef<Box>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    // Ink handles this via the terminal scrollback naturally
  }, [messages.length, streamingText])

  return (
    <Box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
      {messages.map((msg, idx) => {
        const prefix = messagePrefix(msg.role)
        const color = messageColor(msg.role)
        const wrapped = wrapText(msg.content, 80)

        return (
          <Box key={msg.id} flexDirection="column">
            {msg.role === 'user' && idx > 0 && (
              <Box>
                <Text color={theme.dimGreen}>{'─'.repeat(40)}</Text>
              </Box>
            )}
            {msg.role === 'tool' && msg.toolName ? (
              <Box flexDirection="column">
                <Box>
                  <Text color={theme.yellow}>🔧 </Text>
                  <Text color={theme.yellow} bold>
                    {msg.toolName}
                  </Text>
                </Box>
                {msg.content && (
                  <Box paddingLeft={3}>
                    <Text color={theme.dimGreen}>
                      {msg.content.length > 200
                        ? msg.content.slice(0, 200) + '…'
                        : msg.content}
                    </Text>
                  </Box>
                )}
              </Box>
            ) : (
              wrapped.map((line, lineIdx) => (
                <Box key={lineIdx}>
                  <Text color={lineIdx === 0 ? theme.dimGreen : theme.dimGreen}>
                    {lineIdx === 0 ? prefix : '│ '}
                  </Text>
                  <Text color={color}>{line}</Text>
                </Box>
              ))
            )}
          </Box>
        )
      })}

      {/* Streaming indicator */}
      {isStreaming && streamingText && (
        <Box flexDirection="column">
          {wrapText(streamingText, 80).map((line, lineIdx) => (
            <Box key={lineIdx}>
              <Text color={theme.dimGreen}>{lineIdx === 0 ? '│ ' : '│ '}</Text>
              <Text color={theme.green}>{line}</Text>
            </Box>
          ))}
        </Box>
      )}

      {isStreaming && !streamingText && (
        <Box>
          <Text color={theme.green}>│ </Text>
          <Text color={theme.dimGreen}>▋</Text>
        </Box>
      )}
    </Box>
  )
})
