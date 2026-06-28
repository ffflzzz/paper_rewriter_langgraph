/**
 * Thread Store — 持久化管理 thread/session 切换
 *
 * 使用文件系统 (~/.rewriter/threads.json) 持久化当前 threadId 和 session 元数据。
 * 消息持久化通过 HTTP 调用后端 /api/sessions/* 端点写入 sessions.db。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const THREADS_DIR = join(homedir(), '.rewriter')
const THREADS_META_FILE = join(THREADS_DIR, 'threads.json')

// ── Thread 元数据结构 ──

export interface ThreadMeta {
  id: string
  title: string
  createdAt: number
  lastActive: number
  messageCount: number
}

interface ThreadsStore {
  currentThreadId: string | null
  threads: Record<string, ThreadMeta>
}

function loadStore(): ThreadsStore {
  try {
    if (!existsSync(THREADS_META_FILE)) {
      return { currentThreadId: null, threads: {} }
    }
    return JSON.parse(readFileSync(THREADS_META_FILE, 'utf-8')) as ThreadsStore
  } catch {
    return { currentThreadId: null, threads: {} }
  }
}

function saveStore(store: ThreadsStore): void {
  if (!existsSync(THREADS_DIR)) {
    mkdirSync(THREADS_DIR, { recursive: true })
  }
  writeFileSync(THREADS_META_FILE, JSON.stringify(store, null, 2), 'utf-8')
}

/** 获取当前 threadId，如果没有则返回 null */
export function getCurrentThreadId(): string | null {
  return loadStore().currentThreadId
}

/** 设置当前 threadId */
export function setCurrentThreadId(threadId: string): void {
  const store = loadStore()
  store.currentThreadId = threadId
  saveStore(store)
}

/** 创建新 thread，返回 threadId */
export function createThread(title: string = ''): string {
  const threadId = crypto.randomUUID()
  const now = Date.now()
  const store = loadStore()
  store.currentThreadId = threadId
  store.threads[threadId] = {
    id: threadId,
    title,
    createdAt: now,
    lastActive: now,
    messageCount: 0,
  }
  saveStore(store)
  return threadId
}

/** 列出所有 thread 元数据 */
export function listThreads(): ThreadMeta[] {
  const store = loadStore()
  return Object.values(store.threads).sort(
    (a, b) => b.lastActive - a.lastActive
  )
}

/** 删除一个 thread */
export function deleteThread(threadId: string): boolean {
  const store = loadStore()
  if (!store.threads[threadId]) return false
  delete store.threads[threadId]
  if (store.currentThreadId === threadId) {
    store.currentThreadId = Object.keys(store.threads)[0] || null
  }
  saveStore(store)
  return true
}

/** 更新 thread 最后活跃时间和消息计数 */
export function updateThreadMeta(threadId: string, updates: Partial<ThreadMeta>): void {
  const store = loadStore()
  if (store.threads[threadId]) {
    store.threads[threadId] = { ...store.threads[threadId], ...updates, lastActive: Date.now() }
    saveStore(store)
  }
}

/** 获取当前 thread 的元数据 */
export function getCurrentThreadMeta(): ThreadMeta | null {
  const store = loadStore()
  if (store.currentThreadId && store.threads[store.currentThreadId]) {
    return store.threads[store.currentThreadId]
  }
  return null
}
