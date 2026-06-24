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
  if (role === 'user') return '▸ You: '
  if (role === 'assistant') return '│ '
  if (role === 'tool') return '🔧 '
  return '  '
}

function messageColor(role: string): string {
  if (role === 'user') return theme.white
  if (role === 'assistant') return theme.green
  if (role === 'tool') return theme.yellow
  return theme.dimGreen
}

export const TranscriptPane = memo(function TranscriptPane({
  messages,
  streamingText,
  isStreaming,
}: Props) {
  // 只显示最后N行，最新的在底部（像Hermes一样）
  const termHeight = process.stdout.rows || 24
  const maxVisibleLines = Math.max(5, termHeight - 8)

  // 展开所有消息为行
  const allLines: Array<{ key: string; prefix: string; text: string; color: string }> = []

  for (const msg of messages) {
    if (msg.role === 'tool' && msg.toolName) {
      allLines.push({ key: `${msg.id}-tool`, prefix: '', text: `🔧 ${msg.toolName}`, color: theme.yellow })
      if (msg.content) {
        const preview = msg.content.length > 120 ? msg.content.slice(0, 120) + '…' : msg.content
        allLines.push({ key: `${msg.id}-result`, prefix: '   ', text: preview, color: theme.dimGreen })
      }
    } else {
      const wrapped = wrapText(msg.content, 80)
      for (let i = 0; i < wrapped.length; i++) {
        const prefix = i === 0 ? messagePrefix(msg.role) : '│ '
        allLines.push({ key: `${msg.id}-${i}`, prefix, text: wrapped[i], color: messageColor(msg.role) })
      }
    }
    // 用户消息后加分隔线
    if (msg.role === 'user') {
      allLines.push({ key: `${msg.id}-sep`, prefix: '', text: '─'.repeat(40), color: theme.dimGreen })
    }
  }

  // Streaming行
  if (isStreaming && streamingText) {
    const wrapped = wrapText(streamingText, 80)
    for (let i = 0; i < wrapped.length; i++) {
      const prefix = i === 0 ? '│ ' : '│ '
      allLines.push({ key: `streaming-${i}`, prefix, text: wrapped[i], color: theme.green })
    }
  }

  // 取最后N行
  const visibleLines = allLines.slice(-maxVisibleLines)

  return (
    <Box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
      {visibleLines.map((line) => (
        <Box key={line.key}>
          {line.prefix && (
            <Text color={theme.dimGreen}>{line.prefix}</Text>
          )}
          <Text color={line.color}>{line.text}</Text>
        </Box>
      ))}
    </Box>
  )
})
