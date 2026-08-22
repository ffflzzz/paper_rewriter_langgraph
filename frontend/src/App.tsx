import { useState } from 'react'
import { useRunStatus, useRuns, useAgentFeed } from './hooks'
import { Sidebar } from './components/Sidebar'
import { NewRunForm } from './components/NewRunForm'
import { AgentConsoleView } from './components/AgentConsoleView'

type View = { page: 'new' } | { page: 'run'; runId: string }

export default function App() {
  const [view, setView] = useState<View>({ page: 'new' })
  const { status } = useRunStatus()
  const { runs, reload: reloadRuns } = useRuns()

  // 仅当右侧正在看"活着的运行"时订阅 SSE
  const liveRunId = status?.status === 'running' ? status.run_id : null
  const viewingLive = view.page === 'run' && liveRunId !== null && view.runId === liveRunId
  const { items, stage, connected, clear } = useAgentFeed(viewingLive)

  function handleStarted(runId: string) {
    setView({ page: 'run', runId })
    clear()
    reloadRuns()
  }

  function openRun(runId: string) {
    setView({ page: 'run', runId })
    clear()
  }

  return (
    <div className="app">
      <Sidebar
        runs={runs}
        activeRunId={view.page === 'run' ? view.runId : null}
        onSelect={openRun}
        onNew={() => setView({ page: 'new' })}
      />

      <main className="main">
        {view.page === 'new' && <NewRunForm onStart={handleStarted} />}

        {view.page === 'run' && (
          status?.run_id === view.runId ? (
            <AgentConsoleView
              status={status}
              items={items}
              stage={stage}
              sseConnected={connected}
              onClear={clear}
            />
          ) : (
            <section className="new-run">
              <h2>{view.runId}</h2>
              <p className="empty-hint">
                该运行的实时详情仅在后端内存中保留（服务重启后不可回放）。
                <br />
                章节产物在 <code>runs/{view.runId}/chapters/</code>，最终 PDF 在{' '}
                <code>runs/{view.runId}/output.pdf</code>。
              </p>
            </section>
          )
        )}
      </main>
    </div>
  )
}
