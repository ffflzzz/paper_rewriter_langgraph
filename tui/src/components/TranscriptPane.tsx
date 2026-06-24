import React, { memo } from 'react'
import { Box, Text } from 'ink'
import { theme } from '../lib/theme.js'
import { wrapText } from '../lib/utils.js'

interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolName?: string
  timestamp: number
}

interface Props {
  messages: Message[]
  streamingText: string
  isStreaming: boolean
}

function messagePrefix(role: string): string {
  if (role === 'user') return '● '
  if (role === 'assistant') return '│ '
  if (role === 'tool') return '🔧 '
  return '  '
}

function messageColor(role: string): string {
  if (role === 'user') return theme.orange
  if (role === 'assistant') return theme.green
  if (role === 'tool') return theme.yellow
  return theme.dimGreen
}

export const TranscriptPane = memo(function TranscriptPane({
  messages,
  streamingText,
  isStreaming,
}: Props) {
  const contentLines: Array<{ key: string; prefix: string; text: string; color: string; prefixColor?: string }> = []

  for (const msg of messages) {
    if (msg.role === 'tool' && msg.toolName) {
      contentLines.push({ key: `${msg.id}-tool`, prefix: '', text: `🔧 ${msg.toolName}`, color: theme.yellow })
      if (msg.content) {
        const preview = msg.content.length > 120 ? msg.content.slice(0, 120) + '…' : msg.content
        contentLines.push({ key: `${msg.id}-result`, prefix: '   ', text: preview, color: theme.dimGreen })
      }
    } else {
      const wrapped = wrapText(msg.content, 80)
      for (let i = 0; i < wrapped.length; i++) {
        const prefix = i === 0 ? messagePrefix(msg.role) : '│ '
        contentLines.push({
          key: `${msg.id}-${i}`,
          prefix,
          text: wrapped[i],
          color: messageColor(msg.role),
          prefixColor: msg.role === 'user' ? theme.orange : undefined,
        })
      }
    }
    if (msg.role === 'user') {
      contentLines.push({ key: `${msg.id}-sep`, prefix: '', text: '───', color: theme.dimGreen })
    }
  }

  if (isStreaming && streamingText) {
    const wrapped = wrapText(streamingText, 80)
    for (let i = 0; i < wrapped.length; i++) {
      contentLines.push({ key: `streaming-${i}`, prefix: '│ ', text: wrapped[i], color: theme.green })
    }
  }

  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      {/* Spacer pushes content to bottom */}
      <Box flexGrow={1} />
      {contentLines.map((line) => (
        <Box key={line.key}>
          {line.prefix && <Text color={line.prefixColor || theme.dimGreen}>{line.prefix}</Text>}
          <Text color={line.color}>{line.text}</Text>
        </Box>
      ))}
    </Box>
  )
})
