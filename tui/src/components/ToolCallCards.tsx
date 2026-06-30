import { Box, Text } from 'ink'
import React, { memo } from 'react'
import { theme } from '../lib/theme.js'
import type { ToolCallInfo } from '../lib/types.js'

interface Props {
  toolCalls: ToolCallInfo[]
}

// 中文工具名映射
const TOOL_NAMES: Record<string, string> = {
  'search_paper': '搜索论文',
  'download_paper': '下载论文',
  'read_original_segment': '读取原文',
  'write_chapter': '写章节',
  'read_chapter': '读取章节',
  'list_chapters': '列出章节',
  'self_review_chapter': '自审章节',
  'save_outline': '保存大纲',
  'generate_pdf': '生成PDF',
  'search_original': '搜索原文',
}

// 工具图标
const TOOL_ICONS: Record<string, string> = {
  'search_paper': '🔍',
  'download_paper': '📥',
  'read_original_segment': '📖',
  'write_chapter': '✍️',
  'read_chapter': '📖',
  'list_chapters': '📋',
  'self_review_chapter': '🔍',
  'save_outline': '📝',
  'generate_pdf': '📄',
  'search_original': '🔍',
}

function formatArgs(args: string): string {
  try {
    const parsed = JSON.parse(args)
    const parts: string[] = []
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && v.length > 60) {
        parts.push(`${k}="${v.slice(0, 60)}…"`)
      } else {
        parts.push(`${k}=${JSON.stringify(v)}`)
      }
    }
    return parts.join(', ')
  } catch {
    return args.length > 80 ? args.slice(0, 80) + '…' : args
  }
}

function formatDuration(startMs: number): string {
  const elapsed = Date.now() - startMs
  if (elapsed < 1000) return `${elapsed}ms`
  return `${(elapsed / 1000).toFixed(1)}s`
}

export const ToolCallCards = memo(function ToolCallCards({ toolCalls }: Props) {
  if (toolCalls.length === 0) return null

  return (
    <Box flexDirection="column" paddingLeft={1}>
      {toolCalls.map(tc => (
        <Box key={tc.id} flexDirection="column">
          {/* Tool name + status + duration */}
          <Box>
            <Text color={tc.status === 'running' ? theme.yellow : theme.green}>
              {tc.status === 'running' ? '⏳' : '✅'} {TOOL_ICONS[tc.name] || '🔧'} {TOOL_NAMES[tc.name] || tc.name}
            </Text>
            <Text color={theme.dimGreen}> ({tc.name})</Text>
            {tc.startedAt && (
              <Text color={theme.dimGreen}> · {formatDuration(tc.startedAt)}</Text>
            )}
          </Box>
          {/* Args */}
          {tc.args && (
            <Box paddingLeft={3}>
              <Text color={theme.dimGreen}>▸ {formatArgs(tc.args)}</Text>
            </Box>
          )}
          {/* Result */}
          {tc.status === 'done' && tc.result && (
            <Box paddingLeft={3} flexDirection="column">
              <Text color={theme.green}>
                {tc.result.length > 300 ? tc.result.slice(0, 300) + '…' : tc.result}
              </Text>
            </Box>
          )}
        </Box>
      ))}
    </Box>
  )
})
