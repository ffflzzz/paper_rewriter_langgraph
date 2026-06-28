/**
 * Configuration management for Paper Rewriter.
 * Config stored at ~/.rewriter/config.json
 * Providers match Hermes exactly.
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

// Hermes-compatible provider list
export const PROVIDERS: Record<string, { name: string; baseUrl: string; models: string[]; envKey: string }> = {
  'mimo': {
    name: 'MiMo (小米)',
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
    models: ['mimo-v2.5-pro', 'mimo-v2-flash'],
    envKey: 'MIMO_API_KEY',
  },
  'anthropic': {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307'],
    envKey: 'ANTHROPIC_API_KEY',
  },
  'openai-codex': {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-mini'],
    envKey: 'OPENAI_API_KEY',
  },
  'openrouter': {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['anthropic/claude-sonnet-4-20250514', 'openai/gpt-4o', 'google/gemini-2.0-flash'],
    envKey: 'OPENROUTER_API_KEY',
  },
  'nous': {
    name: 'Nous Portal',
    baseUrl: 'https://api.nousresearch.com/v1',
    models: ['hermes-3-llama-3.1-405b', 'hermes-3-llama-3.1-70b'],
    envKey: 'NOUS_API_KEY',
  },
  'zai': {
    name: 'z.ai (智谱 GLM)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-plus', 'glm-4-flash'],
    envKey: 'GLM_API_KEY',
  },
  'kimi-coding': {
    name: 'Kimi (月之暗面)',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-128k', 'moonshot-v1-32k'],
    envKey: 'KIMI_API_KEY',
  },
  'minimax': {
    name: 'MiniMax',
    baseUrl: 'https://api.minimax.chat/v1',
    models: ['abab6.5s-chat', 'abab6.5-chat'],
    envKey: 'MINIMAX_API_KEY',
  },
  'minimax-cn': {
    name: 'MiniMax (国内)',
    baseUrl: 'https://api.minimax.chat/v1',
    models: ['abab6.5s-chat', 'abab6.5-chat'],
    envKey: 'MINIMAX_CN_API_KEY',
  },
  'deepseek': {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    envKey: 'DEEPSEEK_API_KEY',
  },
  'agnes-ai': {
    name: 'Agnes AI',
    baseUrl: 'https://apihub.agnes-ai.com/v1',
    models: ['Agnes-2.0-Flash'],
    envKey: 'AGNES_API_KEY',
  },
  'custom': {
    name: 'Custom (OpenAI兼容)',
    baseUrl: '',
    models: [],
    envKey: 'CUSTOM_API_KEY',
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
