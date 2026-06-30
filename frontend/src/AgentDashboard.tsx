import { useState, useEffect, useRef } from 'react';

// ── 接口定义 ──

interface AGUIEvent {
  type: string;
  timestamp: number;
  data: any;
}

interface ToolCall {
  id: string;
  name: string;
  args: any;
  result?: any;
  status: 'running' | 'complete' | 'error';
  startTime: number;
  endTime?: number;
}

interface StepInfo {
  name: string;
  startTime: number;
  endTime?: number;
  status: 'running' | 'complete' | 'error';
}

interface AgentState {
  status: 'idle' | 'running' | 'complete' | 'error';
  currentNode: string | null;
  toolCalls: ToolCall[];
  steps: StepInfo[];
  progress: {
    chaptersWritten: number;
    totalChapters: number;
    currentStep: string;
    outlineDone: boolean;
  };
}

// ── 工具名称中文映射 ──

const TOOL_LABELS: Record<string, { icon: string; label: string }> = {
  search_original: { icon: '🔍', label: '搜索原文' },
  search_source: { icon: '🔍', label: '搜索原文' },
  read_chapter: { icon: '📖', label: '读取章节' },
  read_original: { icon: '📖', label: '读取原文' },
  write_chapter: { icon: '✍️', label: '写入章节' },
  write_section: { icon: '✍️', label: '写入章节' },
  self_review: { icon: '✅', label: '自审检查' },
  review_chapter: { icon: '✅', label: '自审检查' },
  generate_outline: { icon: '📋', label: '生成大纲' },
  list_chapters: { icon: '📑', label: '列出章节' },
  web_search: { icon: '🌐', label: '网络搜索' },
  cite_reference: { icon: '📚', label: '引用参考' },
  format_output: { icon: '📄', label: '格式输出' },
};

function getToolInfo(name: string): { icon: string; label: string } {
  const key = name.toLowerCase().replace(/[-\s]/g, '_');
  if (TOOL_LABELS[key]) return TOOL_LABELS[key];
  for (const [k, v] of Object.entries(TOOL_LABELS)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return { icon: '🔧', label: name };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}分${s}秒`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── 提取工具结果摘要 ──

function extractResultSummary(_name: string, result: any): string {
  if (!result) return '';
  if (typeof result === 'string') {
    // 尝试解析JSON
    try { result = JSON.parse(result); } catch {}
  }
  if (typeof result === 'string') {
    const s = result.slice(0, 80);
    return s.length < result.length ? s + '...' : s;
  }
  if (typeof result === 'object') {
    if (result.summary) return result.summary;
    if (result.message) return result.message;
    if (result.count != null) return `找到 ${result.count} 条结果`;
    if (result.word_count) return `已保存 ${result.word_count} 字`;
    if (result.score != null) return `评分 ${result.score}/10`;
    if (result.chapters) return `${result.chapters.length} 个章节`;
    if (Array.isArray(result)) return `${result.length} 条结果`;
    if (result.error) return `❌ ${result.error}`;
  }
  return '';
}

// ── 提取工具参数摘要 ──

function extractArgsSummary(args: any): string {
  if (!args) return '';
  if (typeof args === 'string') return args.slice(0, 60);
  if (typeof args === 'object') {
    if (args.query) return args.query;
    if (args.chapter_name) return args.chapter_name;
    if (args.name) return args.name;
    if (args.keyword) return args.keyword;
    const vals = Object.values(args).filter(v => typeof v === 'string');
    if (vals.length > 0) return (vals[0] as string).slice(0, 60);
  }
  return '';
}

// ── 进度计算 ──

function computeProgress(steps: StepInfo[], toolCalls: ToolCall[]): {
  chaptersWritten: number;
  totalChapters: number;
  currentStep: string;
  percentage: number;
} {
  let chaptersWritten = 0;
  let totalChapters = 0;
  let currentStep = '';

  for (const tc of toolCalls) {
    const name = tc.name.toLowerCase();
    if (name.includes('write') && (name.includes('chapter') || name.includes('section'))) {
      if (tc.status === 'complete') chaptersWritten++;
    }
    if (tc.args?.total_chapters) {
      totalChapters = Math.max(totalChapters, tc.args.total_chapters);
    }
  }

  // 从步骤中找当前步骤
  const runningSteps = steps.filter(s => s.status === 'running');
  if (runningSteps.length > 0) {
    currentStep = runningSteps[runningSteps.length - 1].name;
  } else if (steps.length > 0) {
    const last = steps[steps.length - 1];
    if (last.status === 'complete') {
      currentStep = last.name + ' (已完成)';
    }
  }

  // 从工具调用中找章节总数
  for (const tc of toolCalls) {
    if (tc.result?.chapters?.length) {
      totalChapters = Math.max(totalChapters, tc.result.chapters.length);
    }
    if (tc.result?.total_chapters) {
      totalChapters = Math.max(totalChapters, tc.result.total_chapters);
    }
  }

  // 如果没找到总章数，尝试从工具调用名推断
  if (totalChapters === 0 && chaptersWritten > 0) {
    totalChapters = chaptersWritten;
  }

  let percentage = 0;
  if (totalChapters > 0) {
    percentage = Math.min(Math.round((chaptersWritten / totalChapters) * 100), 100);
  } else if (steps.length > 0) {
    const completed = steps.filter(s => s.status === 'complete').length;
    percentage = Math.round((completed / Math.max(steps.length, 1)) * 100);
  }

  return { chaptersWritten, totalChapters, currentStep, percentage };
}

// ══════════════════════════════════════════
//   进度面板
// ══════════════════════════════════════════

function ProgressPanel({ progress, status }: {
  progress: { chaptersWritten: number; totalChapters: number; currentStep: string; percentage: number };
  status: string;
}) {
  const statusLabels: Record<string, { text: string; color: string }> = {
    idle: { text: '⏳ 等待任务', color: 'var(--text-muted)' },
    running: { text: '⚡ 执行中', color: 'var(--success)' },
    complete: { text: '✅ 已完成', color: 'var(--info)' },
    error: { text: '❌ 出错', color: 'var(--error)' },
  };
  const st = statusLabels[status] || statusLabels.idle;

  return (
    <div className="dashboard-progress-panel">
      <div className="progress-panel-header">
        <span className="progress-status" style={{ color: st.color }}>{st.text}</span>
        <span className="progress-percentage">{progress.percentage}%</span>
      </div>
      <div className="progress-bar-track">
        <div
          className="progress-bar-elapsed"
          style={{ width: `${progress.percentage}%` }}
        />
      </div>
      <div className="progress-panel-detail">
        {progress.currentStep && (
          <span className="progress-current-step">📝 {progress.currentStep}</span>
        )}
        {progress.totalChapters > 0 && (
          <span className="progress-chapters">
            章节: {progress.chaptersWritten} / {progress.totalChapters}
          </span>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════
//   工具调用卡片
// ══════════════════════════════════════════

function ToolCallCard({ tc }: { tc: ToolCall }) {
  const { icon, label } = getToolInfo(tc.name);
  const argsSummary = extractArgsSummary(tc.args);
  const resultSummary = extractResultSummary(tc.name, tc.result);
  const duration = tc.endTime ? tc.endTime - tc.startTime : null;
  const isRunning = tc.status === 'running';

  return (
    <div className={`tc-card tc-card-${tc.status}`}>
      <div className="tc-card-header">
        <span className="tc-card-icon">{icon}</span>
        <span className="tc-card-label">{label}</span>
        {isRunning && <span className="tc-card-spinner" />}
        {tc.status === 'complete' && <span className="tc-card-badge tc-card-done">✓</span>}
        {tc.status === 'error' && <span className="tc-card-badge tc-card-err">✗</span>}
      </div>
      {argsSummary && (
        <div className="tc-card-args">
          <span className="tc-card-args-label">参数:</span> {argsSummary}
        </div>
      )}
      {resultSummary && (
        <div className="tc-card-result">
          <span className="tc-card-result-arrow">→</span> {resultSummary}
        </div>
      )}
      {isRunning && !resultSummary && (
        <div className="tc-card-running-text">执行中...</div>
      )}
      {duration != null && (
        <div className="tc-card-duration">⏱ {formatDuration(duration)}</div>
      )}
    </div>
  );
}

function ToolCallsSection({ toolCalls }: { toolCalls: ToolCall[] }) {
  if (toolCalls.length === 0) return null;

  // 显示最近的工具调用，最多12个
  const recent = toolCalls.slice(-12);

  return (
    <div className="tc-section">
      <h4 className="tc-section-title">🔧 工具调用记录 ({toolCalls.length})</h4>
      <div className="tc-cards-grid">
        {recent.map(tc => (
          <ToolCallCard key={tc.id} tc={tc} />
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════
//   执行时间线
// ══════════════════════════════════════════

function TimelinePanel({ steps }: { steps: StepInfo[] }) {
  if (steps.length === 0) return null;

  return (
    <div className="tl-section">
      <h4 className="tl-section-title">⏱ 执行时间线</h4>
      <div className="tl-track">
        {steps.map((step, i) => {
          const duration = step.endTime ? step.endTime - step.startTime : null;
          const isRunning = step.status === 'running';
          return (
            <div key={`${step.name}-${i}`} className={`tl-node tl-node-${step.status}`}>
              <div className="tl-dot-container">
                <div className={`tl-dot tl-dot-${step.status}`} />
                {i < steps.length - 1 && <div className="tl-line" />}
              </div>
              <div className="tl-content">
                <div className="tl-name">
                  {isRunning && <span className="tl-live-indicator">●</span>}
                  {step.name}
                </div>
                <div className="tl-meta">
                  <span className="tl-time">{formatTime(step.startTime)}</span>
                  {duration != null && (
                    <span className="tl-duration">{formatDuration(duration)}</span>
                  )}
                  {isRunning && <span className="tl-running-text">进行中</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════
//   图结构面板（从 /pr/api/graph 动态加载）
// ══════════════════════════════════════════

function PipelineGraphPanel({ activeNode, nodeHistory }: {
  activeNode: string | null;
  nodeHistory: Record<string, { count: number; lastMsg: string }>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<any>(null);
  const nodesRef = useRef<any>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [graphData, setGraphData] = useState<any>(null);

  // 从API加载图结构
  useEffect(() => {
    fetch(`${window.location.origin}/pr/api/graph`)
      .then(r => r.json())
      .then(data => setGraphData(data))
      .catch(e => console.error('Failed to load graph:', e));
  }, []);

  // 初始化vis.js图
  useEffect(() => {
    if (!containerRef.current || !graphData) return;

    const script = document.createElement('script');
    script.src = '/pr/vis-network.min.js';
    script.onload = () => {
      const vis = (window as any).vis;
      if (!vis || !containerRef.current) return;

      const COLORS: Record<string, { background: string; border: string; highlight: { background: string; border: string } }> = {
        start: { background: '#1a3a2a', border: '#3fb950', highlight: { background: '#2a5a3a', border: '#5fd97f' } },
        process: { background: '#1a2a3a', border: '#58a6ff', highlight: { background: '#2a4a6a', border: '#78c6ff' } },
        decision: { background: '#3a2a1a', border: '#d29922', highlight: { background: '#5a4a2a', border: '#f2b942' } },
        tool: { background: '#1a1a2a', border: '#a78bfa', highlight: { background: '#2a2a4a', border: '#c4b5fd' } },
        end: { background: '#2a1a1a', border: '#f85149', highlight: { background: '#4a2a2a', border: '#ff7169' } },
      };

      const nodes = new vis.DataSet(graphData.nodes.map((n: any) => ({
        id: n.id,
        label: n.label,
        shape: n.type === 'start' || n.type === 'end' ? 'dot' : 'box',
        size: n.type === 'start' || n.type === 'end' ? 20 : undefined,
        margin: { top: 10, right: 16, bottom: 10, left: 16 },
        font: { color: '#e6e6e6', size: 12, face: '-apple-system, sans-serif' },
        color: COLORS[n.type] || COLORS.process,
        borderWidth: 2,
        shadow: { enabled: false },
        title: n.desc,
      })));

      const edges = new vis.DataSet(graphData.edges.map((e: any) => ({
        from: e.from,
        to: e.to,
        label: e.label || '',
        arrows: { to: { enabled: true, scaleFactor: 0.8 } },
        font: { color: '#8b949e', size: 9, strokeWidth: 0, align: 'middle' },
        color: { color: e.color || '#484f58', highlight: e.color || '#58a6ff', inherit: false },
        smooth: { type: 'cubicBezier', roundness: 0.3 },
        width: 1.5,
      })));

      nodesRef.current = nodes;

      networkRef.current = new vis.Network(containerRef.current, { nodes, edges }, {
        physics: {
          enabled: true,
          solver: 'forceAtlas2Based',
          forceAtlas2Based: {
            gravitationalConstant: -80,
            centralGravity: 0.01,
            springLength: 200,
            springConstant: 0.08,
            damping: 0.4,
            avoidOverlap: 0.5,
          },
          stabilization: { iterations: 200 },
        },
        interaction: { dragNodes: true, zoomView: true, dragView: true, hover: true },
        layout: { improvedLayout: false },
      });

      networkRef.current.on('click', (params: any) => {
        setSelectedNode(params.nodes.length ? params.nodes[0] : null);
      });
    };
    document.head.appendChild(script);

    return () => {
      if (networkRef.current) { networkRef.current.destroy(); networkRef.current = null; }
    };
  }, [graphData]);

  // 高亮活跃节点
  useEffect(() => {
    const nodes = nodesRef.current;
    const network = networkRef.current;
    if (!nodes || !network || !graphData) return;

    for (const n of graphData.nodes) {
      const hist = nodeHistory[n.id] || nodeHistory[n.id.replace('t_', '')];
      const execLabel = hist && hist.count > 0 ? `\n(${hist.count}次)` : '';
      const COLORS: Record<string, any> = {
        start: { background: '#1a3a2a', border: '#3fb950' },
        process: { background: '#1a2a3a', border: '#58a6ff' },
        tool: { background: '#1a1a2a', border: '#a78bfa' },
        end: { background: '#2a1a1a', border: '#f85149' },
      };
      const color = COLORS[n.type] || COLORS.process;
      if (nodes.get(n.id)) {
        nodes.update({ id: n.id, label: n.label + execLabel, borderWidth: 2, shadow: { enabled: false }, color });
      }
    }

    if (activeNode && nodes.get(activeNode)) {
      nodes.update({
        id: activeNode,
        borderWidth: 4,
        shadow: { enabled: true, color: 'rgba(88,166,255,0.8)', size: 20, x: 0, y: 0 },
        color: { background: '#2a4a6a', border: '#78c6ff', highlight: { background: '#3a6a9a', border: '#98e6ff' } },
      });
      network.selectNodes([activeNode]);
      network.focus(activeNode, { scale: 1.3, animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
    }
  }, [activeNode, nodeHistory, graphData]);

  const selDef = graphData?.nodes.find((n: any) => n.id === selectedNode);
  const selHist = selectedNode ? (nodeHistory[selectedNode] || nodeHistory[selectedNode.replace('t_', '')]) : null;

  return (
    <div className="pipeline-graph-section">
      <div ref={containerRef} className="pipeline-graph-container" />
      {selDef && (
        <div className="graph-node-info">
          <div className="graph-node-info-title">{selDef.label}</div>
          <div className="graph-node-info-desc">{selDef.desc}</div>
          {selHist && selHist.count > 0 && (
            <div className="graph-node-info-stat">
              执行 {selHist.count} 次 · 最近: {selHist.lastMsg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════
//   ETCLOVG 指标面板
// ══════════════════════════════════════════

interface ETCLOVGData {
  governance: {
    token_usage: {
      session_input_tokens: number;
      session_output_tokens: number;
      session_total_tokens: number;
      session_cost_yuan: number;
      request_count: number;
    };
    rate_limiter: {
      max_requests: number;
      window_seconds: number;
      current_count: number;
      remaining: number;
    };
    pricing: {
      input_per_1k: number;
      output_per_1k: number;
      currency: string;
    };
  };
  versioning: {
    current_version: string;
    total_versions: number;
    history: any[];
  };
  evaluation: {
    total_runs: number;
    recent_mean: number;
    regression: {
      regression: boolean;
      latest_score?: number;
      mean?: number;
      std?: number;
      threshold?: number;
      reason?: string;
    };
    trend: Array<{ combined_score: number; [key: string]: any }>;
  };
}

function ETCLOVGPanel() {
  const [data, setData] = useState<ETCLOVGData | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const base = window.location.origin;
        const resp = await fetch(`${base}/pr/api/etclovg`);
        if (resp.ok) setData(await resp.json());
      } catch (_) {}
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  if (!data) return null;

  const { governance: g, versioning: v, evaluation: e } = data;
  const scores = e.trend.slice(-10).map(t => t.combined_score);
  const maxScore = Math.max(...scores, 1);

  return (
    <div className="etclovg-section">
      <h4>📊 ETCLOVG 指标</h4>
      <div className="etclovg-rows">
        {/* Governance */}
        <div className="etclovg-row">
          <span className="etclovg-label">🏛️ 治理</span>
          <span className="etclovg-metric">输入: {g.token_usage.session_input_tokens.toLocaleString()}</span>
          <span className="etclovg-metric">输出: {g.token_usage.session_output_tokens.toLocaleString()}</span>
          <span className="etclovg-metric">总计: {g.token_usage.session_total_tokens.toLocaleString()}</span>
          <span className="etclovg-metric">费用: ¥{g.token_usage.session_cost_yuan.toFixed(4)}</span>
          <span className={`etclovg-metric ${g.rate_limiter.remaining < 3 ? 'etclovg-warn' : ''}`}>
            限流: {g.rate_limiter.current_count}/{g.rate_limiter.max_requests} (剩余{g.rate_limiter.remaining})
          </span>
        </div>

        {/* Versioning */}
        <div className="etclovg-row">
          <span className="etclovg-label">🔖 版本</span>
          <span className="etclovg-metric">当前: <code>{v.current_version.slice(0, 8)}</code></span>
          <span className="etclovg-metric">总版本: {v.total_versions}</span>
        </div>

        {/* Evaluation */}
        <div className="etclovg-row">
          <span className="etclovg-label">📈 评估</span>
          <span className="etclovg-metric">均分: {(e.recent_mean ?? 0).toFixed(1)}</span>
          {e.regression.latest_score != null && (
            <span className="etclovg-metric">最新: {e.regression.latest_score.toFixed(1)}</span>
          )}
          {e.regression.regression && (
            <span className="etclovg-metric etclovg-alert">⚠️ 回归!</span>
          )}
          <span className="etclovg-metric">运行: {e.total_runs}</span>
          {/* Mini bar chart */}
          <span className="etclovg-bars" title={`最近${scores.length}次: ${scores.join(', ')}`}>
            {scores.map((s, i) => (
              <span
                key={i}
                className={`etclovg-bar ${e.regression.threshold != null && s < e.regression.threshold ? 'etclovg-bar-low' : ''}`}
                style={{ height: `${Math.max((s / maxScore) * 18, 2)}px` }}
                title={`${s.toFixed(1)}`}
              />
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════
//   PDF 下载面板
// ══════════════════════════════════════════

interface OutputFile {
  name: string;
  size: number;
  modified: number;
}

function PDFDownloadPanel() {
  const [files, setFiles] = useState<OutputFile[]>([]);
  const [expanded, setExpanded] = useState(false);

  const loadFiles = async () => {
    try {
      const base = window.location.origin;
      const resp = await fetch(`${base}/pr/api/output/list`);
      if (resp.ok) {
        const data = await resp.json();
        setFiles(data.files || []);
      }
    } catch (e) {}
  };

  useEffect(() => {
    loadFiles();
    const interval = setInterval(loadFiles, 30000);
    return () => clearInterval(interval);
  }, []);

  if (files.length === 0) return null;

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (ts: number) => new Date(ts * 1000).toLocaleString();

  return (
    <div className="pdf-section">
      <h4 onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer' }}>
        📄 已生成的PDF {expanded ? '▼' : '▶'} ({files.length})
      </h4>
      {expanded && (
        <div className="pdf-list">
          {files.map((f, i) => (
            <div key={i} className="pdf-item">
              <div className="pdf-info">
                <span className="pdf-name">{f.name}</span>
                <span className="pdf-meta">{formatSize(f.size)} · {formatDate(f.modified)}</span>
              </div>
              <a href={`/pr/api/output/${encodeURIComponent(f.name)}`} download={f.name} className="pdf-download-btn">
                ⬇ 下载
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════
//   主仪表盘
// ══════════════════════════════════════════

export function AgentDashboard({ runtimeUrl }: { runtimeUrl: string }) {
  const [state, setState] = useState<AgentState>({
    status: 'idle',
    currentNode: null,
    toolCalls: [],
    steps: [],
    progress: { chaptersWritten: 0, totalChapters: 0, currentStep: '', outlineDone: false },
  });
  const [isConnected, setIsConnected] = useState(false);
  const [nodeHistory, setNodeHistory] = useState<Record<string, { count: number; lastMsg: string }>>({});
  const lastPollRef = useRef<number>(0);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const pollEvents = async () => {
      try {
        const base = window.location.origin;
        const after = lastPollRef.current > 0 ? `?after=${lastPollRef.current}` : '';
        const resp = await fetch(`${base}/pr/api/event-log${after}`);
        if (resp.ok) {
          const data = await resp.json();
          const newEvents: AGUIEvent[] = (data.events || []).map((e: any) => ({
            type: e.type,
            timestamp: e.timestamp * 1000,
            data: e.data,
          }));

          if (newEvents.length > 0) {
            lastPollRef.current = newEvents[newEvents.length - 1].timestamp / 1000;

            setState(prev => {
              let newStatus = prev.status;
              const newToolCalls = [...prev.toolCalls];
              const newSteps = [...prev.steps];
              const toolCallMap = new Map<string, number>();
              const stepMap = new Map<string, number>();

              // 为快速查找建立索引
              newToolCalls.forEach((tc, i) => toolCallMap.set(tc.id, i));
              newSteps.forEach((s, i) => stepMap.set(s.name + '-' + s.startTime, i));

              for (const evt of newEvents) {
                const d = evt.data || {};

                // 处理步骤事件
                if (evt.type === 'STEP_STARTED' || d.type === 'STEP_STARTED') {
                  const stepName = d.stepName || d.step_name || d.name || '未知步骤';
                  const key = stepName + '-' + evt.timestamp;
                  if (!stepMap.has(key)) {
                    newSteps.push({
                      name: stepName,
                      startTime: evt.timestamp,
                      status: 'running',
                    });
                    stepMap.set(key, newSteps.length - 1);
                  }
                }

                if (evt.type === 'STEP_FINISHED' || d.type === 'STEP_FINISHED') {
                  const stepName = d.stepName || d.step_name || d.name || '';
                  // 找到最近的同名运行中步骤
                  for (let i = newSteps.length - 1; i >= 0; i--) {
                    if (newSteps[i].name === stepName && newSteps[i].status === 'running') {
                      newSteps[i] = { ...newSteps[i], endTime: evt.timestamp, status: 'complete' };
                      break;
                    }
                  }
                }

                // 处理工具调用事件
                if (evt.type === 'TOOL_CALL_START' || d.type === 'TOOL_CALL_START') {
                  const tcId = d.toolCallId || d.tool_call_id || evt.timestamp.toString();
                  const tcName = d.name || d.toolName || d.tool_name || 'unknown';
                  if (!toolCallMap.has(tcId)) {
                    newToolCalls.push({
                      id: tcId,
                      name: tcName,
                      args: d.args,
                      status: 'running',
                      startTime: evt.timestamp,
                    });
                    toolCallMap.set(tcId, newToolCalls.length - 1);
                  }
                }

                if (evt.type === 'TOOL_CALL_END' || d.type === 'TOOL_CALL_END') {
                  const tcId = d.toolCallId || d.tool_call_id || '';
                  const idx = toolCallMap.get(tcId);
                  if (idx != null && newToolCalls[idx]) {
                    newToolCalls[idx] = {
                      ...newToolCalls[idx],
                      status: 'complete',
                      endTime: evt.timestamp,
                      result: d.result,
                    };
                  }
                }

                // 更新运行状态
                if (evt.type === 'RUN_STARTED' || evt.type === 'run_start') newStatus = 'running';
                if (evt.type === 'RUN_FINISHED' || evt.type === 'run_end') newStatus = 'complete';
                if (evt.type === 'RUN_ERROR' || evt.type === 'run_error') newStatus = 'error';
                if (evt.type === 'STEP_STARTED') newStatus = 'running';
              }

              // 自动推断运行中状态
              const hasRunningStep = newSteps.some(s => s.status === 'running');
              const hasRunningTool = newToolCalls.some(t => t.status === 'running');
              if (hasRunningStep || hasRunningTool) {
                newStatus = 'running';
              }

              // 找当前活跃节点
              let currentNode: string | null = null;
              for (let i = newSteps.length - 1; i >= 0; i--) {
                if (newSteps[i].status === 'running') {
                  currentNode = newSteps[i].name;
                  break;
                }
              }
              if (!currentNode) {
                for (let i = newToolCalls.length - 1; i >= 0; i--) {
                  if (newToolCalls[i].status === 'running') {
                    currentNode = newToolCalls[i].name;
                    break;
                  }
                }
              }

              const progress = computeProgress(newSteps, newToolCalls);

              return {
                ...prev,
                status: newStatus,
                currentNode,
                toolCalls: newToolCalls,
                steps: newSteps,
                progress: {
                  chaptersWritten: progress.chaptersWritten,
                  totalChapters: progress.totalChapters,
                  currentStep: progress.currentStep,
                  outlineDone: prev.progress.outlineDone,
                },
              };
            });

            // 更新节点历史
            setNodeHistory(prev => {
              const updated = { ...prev };
              for (const evt of newEvents) {
                const d = evt.data || {};
                const nodeId = d.node_id || d.stepName || d.step_name;
                if (!nodeId) continue;
                if (!updated[nodeId]) {
                  updated[nodeId] = { count: 0, lastMsg: '' };
                }
                if (evt.type === 'STEP_STARTED' || d.type === 'STEP_STARTED') {
                  updated[nodeId].count++;
                  updated[nodeId].lastMsg = d.message || '开始执行';
                }
              }
              return updated;
            });
          }
          setIsConnected(true);
        }
      } catch (e) {
        setIsConnected(false);
      }
    };

    pollEvents();
    pollIntervalRef.current = setInterval(pollEvents, 1500);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [runtimeUrl]);

  const clearEvents = () => {
    setState({
      status: 'idle',
      currentNode: null,
      toolCalls: [],
      steps: [],
      progress: { chaptersWritten: 0, totalChapters: 0, currentStep: '', outlineDone: false },
    });
    setNodeHistory({});
  };

  const progressData = {
    ...state.progress,
    percentage: state.progress.totalChapters > 0
      ? Math.min(Math.round((state.progress.chaptersWritten / state.progress.totalChapters) * 100), 100)
      : state.steps.length > 0
        ? Math.round((state.steps.filter(s => s.status === 'complete').length / state.steps.length) * 100)
        : 0,
  };

  return (
    <div className="agent-dashboard">
      {/* 头部 */}
      <div className="dashboard-header">
        <h3>📊 Agent 监控面板</h3>
        <div className="dashboard-controls">
          <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? '● 已连接' : '○ 未连接'}
          </span>
          <button className="btn-clear" onClick={clearEvents}>🗑 重置</button>
        </div>
      </div>

      {/* 进度面板 */}
      <ProgressPanel progress={progressData} status={state.status} />

      {/* 工具调用卡片 */}
      <ToolCallsSection toolCalls={state.toolCalls} />

      {/* 执行时间线 */}
      <TimelinePanel steps={state.steps} />

      {/* 流程图面板 */}
      <div className="graph-panel-wrapper">
        <h4 className="section-title">🗺️ Agent 流程图</h4>
        <PipelineGraphPanel activeNode={state.currentNode} nodeHistory={nodeHistory} />
      </div>

      {/* 状态指示 */}
      <div className="graph-status">
        <span className={`status-dot ${state.status}`} />
        <span className="status-text">
          {state.status === 'idle' && '等待任务'}
          {state.status === 'running' && `执行中... 当前: ${state.currentNode || '-'}`}
          {state.status === 'complete' && '✅ 已完成'}
          {state.status === 'error' && '❌ 出错'}
        </span>
      </div>

      {/* ETCLOVG 指标 */}
      <ETCLOVGPanel />

      {/* PDF 下载 */}
      <PDFDownloadPanel />
    </div>
  );
}
