import type { LoopStage } from '../hooks'

const STAGE_LABEL: Record<LoopStage, string> = {
  idle: '待命',
  think: '思考中 · 生成决策',
  tool: '执行工具调用',
  result: '接收工具结果',
  wait: '已暂停 · 等待你的确认',
  done: '循环结束 · 任务完成',
  error: '循环异常',
}

/**
 * Agent Loop 状态动画：
 *   ┌──────────────────────────────┐
 *   ▼                              │
 * Think ──▶ Tool Call ──▶ Result ──┘   （done / error 终态）
 */
export function LoopConsole({ stage }: { stage: LoopStage }) {
  const active = (s: LoopStage) => (stage === s ? 'node active' : 'node')

  return (
    <div className="loop-console" data-stage={stage}>
      <svg viewBox="0 0 640 132" className="loop-svg" aria-label="agent loop">
        {/* 正向连线 */}
        <path className="edge" d="M 176 52 H 262" markerEnd="url(#arrow)" />
        <path className="edge" d="M 424 52 H 510" markerEnd="url(#arrow)" />
        {/* 回环弧线：Result → Think */}
        <path
          className={`edge edge-loop${stage === 'think' || stage === 'tool' ? ' flowing' : ''}`}
          d="M 566 84 C 566 128, 74 128, 74 84"
        />
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#5b6285" />
        </marker>

        {/* 节点 */}
        <g className={active('think')} transform="translate(20 24)">
          <rect className="node-box" width="156" height="56" rx="13" />
          <text className="node-emoji" x="26" y="35">🧠</text>
          <text className="node-title" x="50" y="27">Think</text>
          <text className="node-sub" x="50" y="44">推理 / 决策</text>
        </g>

        <g className={active('tool')} transform="translate(262 24)">
          <rect className="node-box" width="162" height="56" rx="13" />
          <text className="node-emoji" x="26" y="35">🔧</text>
          <text className="node-title" x="50" y="27">Tool Use</text>
          <text className="node-sub" x="50" y="44">调用工具</text>
        </g>

        <g className={active('result')} transform="translate(510 24)">
          <rect className="node-box" width="112" height="56" rx="13" />
          <text className="node-emoji" x="18" y="35">📄</text>
          <text className="node-title" x="42" y="27">Result</text>
          <text className="node-sub" x="42" y="44">观察结果</text>
        </g>

        {/* 终态徽章 */}
        <g className={stage === 'done' ? 'node done on' : 'node done'} transform="translate(258 6)">
          <circle cx="0" cy="0" r="0" />
        </g>
      </svg>

      <div className="loop-status">
        <span className={`stage-dot ${stage === 'idle' ? '' : 'run'}`} />
        <span className="stage-label">{STAGE_LABEL[stage]}</span>
        {stage === 'think' && <span className="stage-ellipsis"><i>.</i><i>.</i><i>.</i></span>}
      </div>
    </div>
  )
}
