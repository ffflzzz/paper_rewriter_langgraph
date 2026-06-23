/**
 * AG-UI backend client — connects to the Python FastAPI server.
 *
 * POST /api/copilotkit  — run agent (SSE streaming)
 * GET  /api/status       — agent status
 * GET  /api/sessions     — session list
 */

import type { AgUiEvent, RunAgentInput } from './types.js'

const BASE_URL = process.env.AGUI_URL || 'http://localhost:8765'

export async function fetchStatus(): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE_URL}/api/status`)
  if (!res.ok) throw new Error(`status failed: ${res.status}`)
  return res.json() as Promise<Record<string, unknown>>
}

export async function fetchSessions(): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${BASE_URL}/api/sessions`)
  if (!res.ok) throw new Error(`sessions failed: ${res.status}`)
  const data = (await res.json()) as { sessions: Record<string, unknown>[] }
  return data.sessions
}

export interface StreamCallbacks {
  onEvent: (event: AgUiEvent) => void
  onError: (error: Error) => void
  onDone: () => void
}

/**
 * Run the agent via AG-UI SSE endpoint.
 * Returns an abort function.
 */
export function runAgent(
  messages: Array<{ id: string; role: string; content: string }>,
  threadId: string,
  runId: string,
  callbacks: StreamCallbacks,
): () => void {
  const controller = new AbortController()

  const body: RunAgentInput = {
    threadId,
    runId,
    state: {},
    messages,
  }

  ;(async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/copilotkit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!res.ok) {
        const text = await res.text()
        callbacks.onError(new Error(`AG-UI ${res.status}: ${text}`))
        return
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop()! // keep incomplete chunk

        for (const part of parts) {
          const line = part.trim()
          if (!line || line.startsWith(':')) continue

          // Parse SSE: "data: {...}" or just "{...}"
          let jsonStr = line
          if (line.startsWith('data: ')) {
            jsonStr = line.slice(6)
          } else if (line.startsWith('data:')) {
            jsonStr = line.slice(5)
          }

          if (jsonStr === '[DONE]') continue

          try {
            const event = JSON.parse(jsonStr) as AgUiEvent
            callbacks.onEvent(event)
          } catch {
            // skip non-JSON lines
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        const line = buffer.trim()
        let jsonStr = line
        if (line.startsWith('data: ')) jsonStr = line.slice(6)
        else if (line.startsWith('data:')) jsonStr = line.slice(5)

        if (jsonStr !== '[DONE]') {
          try {
            const event = JSON.parse(jsonStr) as AgUiEvent
            callbacks.onEvent(event)
          } catch {
            // ignore
          }
        }
      }

      callbacks.onDone()
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        callbacks.onDone()
      } else {
        callbacks.onError(err instanceof Error ? err : new Error(String(err)))
      }
    }
  })()

  return () => controller.abort()
}
