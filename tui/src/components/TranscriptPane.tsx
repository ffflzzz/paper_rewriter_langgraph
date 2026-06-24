import React, { memo, useState, useEffect } from 'react'
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

function getTerminalRows(): number {
  // Try multiple methods to get terminal height
  try {
    // Method 1: process.stdout.rows (works in TTY)
    if (process.stdout.rows && process.stdout.rows > 0) return process.stdout.rows
  } catch {}
  try {
    // Method 2: environment variable (set by some terminals)
    const lines = parseInt(process.env.LINES || '0', 10)
    if (lines > 0) return lines
  } catch {}
  try {
    // Method 3: tput lines (works in most terminals)
    const { execSync } = require('child_process')
    const result = execSync('tput lines 2>/dev/null || echo 0', { encoding: 'utf-8' }).trim()
    const r = parseInt(result, 10)
    if (r > 0) return r
  } catch {}
  return 24 // fallback
}

export const TranscriptPane = memo(function TranscriptPane({
  messages,
  streamingText,
  isStreaming,
}: Props) {
  const [termRows, setTermRows] = useState(getTerminalRows)

  useEffect(() => {
    const update = () => setTermRows(getTerminalRows())
    // Listen for terminal resize
    process.stdout.on('resize', update)
    // Also re-check after mount
    const timer = setTimeout(update, 300)
    return () => {
      process.stdout.off('resize', update)
      clearTimeout(timer)
    }
  }, [])

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

  // Reserve: input(1) + status bar(1) + separator(1) = 3
  const reserved = 3
  const available = Math.max(5, termRows - reserved)
  const padLines = Math.max(0, available - contentLines.length)

  return (
    <Box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
      {/* Empty lines at top to push content to bottom */}
      {Array.from({ length: padLines }, (_, i) => (
        <Box key={`pad-${i}`}><Text> </Text></Box>
      ))}
      {/* Content at bottom */}
      {contentLines.map((line) => (
        <Box key={line.key}>
          {line.prefix && <Text color={line.prefixColor || theme.dimGreen}>{line.prefix}</Text>}
          <Text color={line.color}>{line.text}</Text>
        </Box>
      ))}
    </Box>
  )
})
