import { useRef, useState } from 'react'
import { api } from '../api'

interface Props {
  onStart: (runId: string) => void
}

const AUDIENCE_PRESETS = [
  '大一非理工科学生',
  '高中生',
  '计算机专业大学生',
  '完全零基础的普通读者',
]

export function NewRunForm({ onStart }: Props) {
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [audience, setAudience] = useState(AUDIENCE_PRESETS[0])
  const [autoApprove, setAutoApprove] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const canSubmit = title.trim().length > 0 && !submitting

  async function handleUpload(file: File) {
    setError(null)
    setUploading(true)
    try {
      const res = await api.upload(file)
      setText(res.text)
      if (!title.trim()) setTitle(res.filename.replace(/\.(pdf|txt|md)$/i, ''))
    } catch (e) {
      setError(`上传失败：${e}`)
    } finally {
      setUploading(false)
    }
  }

  async function handleSubmit() {
    setError(null)
    setSubmitting(true)
    try {
      const res = await api.startRun({
        paper_title: title.trim(),
        original_text: text,
        target_audience: audience,
        auto_approve: autoApprove,
      })
      onStart(res.run_id)
    } catch (e) {
      setError(String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="new-run">
      <header>
        <h2>新建重写任务</h2>
        <p>
          只需提供论文标题 —— Agent 会自动搜索并下载论文。也可以上传（PDF / TXT / MD）或粘贴全文，跳过检索直接重写。
        </p>
      </header>

      <label className="field">
        <span>论文标题 *</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例如：Attention Is All You Need"
        />
      </label>

      <label className="field">
        <span>目标读者</span>
        <div className="chip-row">
          {AUDIENCE_PRESETS.map((a) => (
            <button
              key={a}
              type="button"
              className={`chip${a === audience ? ' chip-on' : ''}`}
              onClick={() => setAudience(a)}
            >
              {a}
            </button>
          ))}
        </div>
      </label>

      <label className="field">
        <span>
          论文原文 <em>可选 · 留空则由 Agent 自动检索下载；当前 {text.length} 字符</em>
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="可选：粘贴论文全文，或上传 PDF。留空时 Agent 将根据标题自动搜索并下载论文。"
          rows={14}
        />
      </label>

      <div className="form-actions">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.txt,.md"
          hidden
          onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
        />
        <button className="btn-ghost" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? '解析中…' : '📎 上传 PDF / TXT'}
        </button>
        <button className="btn-primary" disabled={!canSubmit} onClick={handleSubmit}>
          {submitting ? '启动中…' : '🚀 启动 Agent'}
        </button>
      </div>

      <label className="auto-approve-row">
        <input
          type="checkbox"
          checked={autoApprove}
          onChange={(e) => setAutoApprove(e.target.checked)}
        />
        <span>
          全自动模式（不推荐）
          <em>关闭时，每次写入大纲/章节/下载前都会暂停等你确认，你还可以附带修改指示</em>
        </span>
      </label>

      {error && <div className="form-error">{error}</div>}
    </section>
  )
}
