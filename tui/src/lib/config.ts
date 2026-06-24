/**
 * Configuration management for Paper Rewriter.
 * Config stored at ~/.rewriter/config.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface RewriterConfig {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
}

const CONFIG_DIR = join(homedir(), '.rewriter')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

// Built-in provider presets
export const PROVIDERS: Record<string, { name: string; baseUrl: string; models: string[] }> = {
  'mimo': {
    name: 'MiMo (小米)',
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
    models: ['mimo-v2.5-pro', 'mimo-v2-flash'],
  },
  'openai': {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-mini'],
  },
  'anthropic': {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307'],
  },
  'openrouter': {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['anthropic/claude-sonnet-4-20250514', 'openai/gpt-4o', 'google/gemini-2.0-flash'],
  },
  'deepseek': {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  'custom': {
    name: 'Custom (OpenAI兼容)',
    baseUrl: '',
    models: [],
  },
}

export function loadConfig(): RewriterConfig | null {
  try {
    if (!existsSync(CONFIG_FILE)) return null
    const raw = readFileSync(CONFIG_FILE, 'utf-8')
    return JSON.parse(raw) as RewriterConfig
  } catch {
    return null
  }
}

export function saveConfig(config: RewriterConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8')
}

export function getConfigOrDie(): RewriterConfig {
  const config = loadConfig()
  if (!config) {
    console.error('No config found. Run `rewriter` to set up.')
    process.exit(1)
  }
  return config
}
