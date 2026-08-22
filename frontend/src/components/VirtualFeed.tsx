import { useEffect, useMemo, useRef, useState } from 'react'
import type { FeedItem } from '../types'

/**
 * 虚拟滚动控制台流：
 * - 每条目按类型有固定槽高（正文钳制在两行内），前缀和数组算绝对偏移
 * - 只渲染视口 ± overscan 内的卡片，几百条事件也只挂载十几个 DOM
 * - 新事件追加到底部；用户上滚即暂停跟随，出现"回到底部"按钮
 */

const BODY_H = 104 // 有正文槽高（标题行 + 两行钳制正文）
const BARE_H = 46 // 无正文槽高
const OVERSCAN = 8

const rowH = (it: FeedItem) => (it.body ? BODY_H : BARE_H)

export function VirtualFeed({ items }: { items: FeedItem[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(560)
  const [stick, setStick] = useState(true)
  const [expanded, setExpanded] = useState<FeedItem | null>(null)

  const offsets = useMemo(() => {
    const arr = new Array<number>(items.length + 1)
    arr[0] = 0
    for (let i = 0; i < items.length; i++) arr[i + 1] = arr[i] + rowH(items[i])
    return arr
  }, [items])

  const total = offsets[items.length] ?? 0

  // 可见窗口（线性扫描，≤500 条无压力）
  const lo = Math.max(0, findIdx(offsets, scrollTop) - OVERSCAN)
  const hi = Math.min(items.length, findIdx(offsets, scrollTop + viewH) + 1 + OVERSCAN)
  const visible = []
  for (let i = lo; i < hi; i++) visible.push(i)

  // 视口高度自适应
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setViewH(el.clientHeight)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // 新条目：吸底时自动跟随
  useEffect(() => {
    const el = scrollRef.current
    if (el && stick) el.scrollTop = el.scrollHeight
  }, [items.length, stick])

  function onScroll() {
    const el = scrollRef.current!
    setScrollTop(el.scrollTop)
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight
    setStick(gap < 48)
  }

  function jumpBottom() {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    setStick(true)
  }

  return (
    <div className="vfeed-wrap">
      <div ref={scrollRef} className="vfeed" onScroll={onScroll}>
        <div style={{ height: total, position: 'relative' }}>
          {visible.map((i) => {
            const it = items[i]
            return (
              <button
                key={it.id}
                className={`feed-card fc-${it.kind}`}
                style={{ position: 'absolute', top: offsets[i], left: 0, right: 0 }}
                onClick={() => it.body && setExpanded(it)}
              >
                <div className="fc-row">
                  <span className="fc-title">{it.title}</span>
                  {it.sub && <span className="fc-sub">{it.sub}</span>}
                  <time>{new Date(it.at).toLocaleTimeString('zh-CN', { hour12: false })}</time>
                </div>
                {it.body && <p className="fc-body">{it.body}</p>}
              </button>
            )
          })}
        </div>
        {items.length === 0 && (
          <div className="empty-hint vfeed-empty">等待 Agent 事件…启动任务后此处实时滚动</div>
        )}
      </div>

      {!stick && items.length > 0 && (
        <button className="jump-btn" onClick={jumpBottom}>
          ↓ 回到底部
        </button>
      )}

      {expanded && (
        <div className="drawer-mask" onClick={() => setExpanded(null)}>
          <article className="drawer" onClick={(e) => e.stopPropagation()}>
            <header>
              <h3>{expanded.title}{expanded.sub ? ` · ${expanded.sub}` : ''}</h3>
              <button className="btn-ghost" onClick={() => setExpanded(null)}>关闭</button>
            </header>
            <div className="drawer-body">
              <p className="expand-body">{expanded.body}</p>
            </div>
          </article>
        </div>
      )}
    </div>
  )
}

/** 找到最后一个 offsets[i] <= y 的下标 */
function findIdx(offsets: number[], y: number): number {
  let idx = 0
  for (let i = 1; i < offsets.length; i++) {
    if (offsets[i] <= y) idx = i
    else break
  }
  return Math.max(0, idx - 1)
}
