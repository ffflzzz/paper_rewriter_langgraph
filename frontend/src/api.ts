import type { RunStatus, RunSummary, GraphNode, GraphEdge, ChapterContent } from './types'

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body?.error) msg = body.error
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

export const api = {
  status: () => fetch('/api/status').then((r) => json<RunStatus>(r)),

  runs: () => fetch('/api/runs').then((r) => json<RunSummary[]>(r)),

  startRun: (body: {
    paper_title: string
    original_text?: string
    target_audience?: string
    max_tool_calls?: number
    auto_approve?: boolean
  }) =>
    fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<{ run_id: string; status: string }>(r)),

  resume: (runId: string, decision: boolean | string) =>
    fetch(`/api/runs/${runId}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    }).then((r) => json<{ status: string; decision: boolean | string }>(r)),

  stopRun: () => fetch('/api/stop', { method: 'POST' }).then((r) => json<{ status: string }>(r)),

  chapter: (runId: string, chapterId: string) =>
    fetch(`/api/chapter/${runId}/${chapterId}`).then((r) => json<ChapterContent>(r)),

  graph: () =>
    fetch('/api/graph').then((r) => json<{ nodes: GraphNode[]; edges: GraphEdge[] }>(r)),

  upload: async (file: File): Promise<{ filename: string; text: string; chars: number }> => {
    const form = new FormData()
    form.append('file', file)
    return fetch('/api/upload', { method: 'POST', body: form }).then((r) => json(r))
  },
}
