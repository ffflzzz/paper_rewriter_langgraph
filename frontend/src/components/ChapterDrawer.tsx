import { useEffect, useState } from 'react'
import { api } from '../api'

interface Props {
  runId: string
  chapterId: string
  onClose: () => void
}

export function ChapterDrawer({ runId, chapterId, onClose }: Props) {
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    api
      .chapter(runId, chapterId)
      .then((c) => alive && setContent(c.content))
      .catch((e) => alive && setError(String(e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [runId, chapterId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="drawer-mask" onClick={onClose}>
      <article className="drawer" onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>{chapterId}</h3>
          <button className="btn-ghost" onClick={onClose}>
            关闭 (Esc)
          </button>
        </header>
        <div className="drawer-body">
          {loading && <p className="empty-hint">加载中…</p>}
          {error && <p className="form-error">{error}</p>}
          {!loading && !error && content.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)}
        </div>
      </article>
    </div>
  )
}
