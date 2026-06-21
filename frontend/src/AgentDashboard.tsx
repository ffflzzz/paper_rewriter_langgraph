import { useState, useEffect, useRef } from 'react';

// AG-UI事件类型
interface AGUIEvent {
  type: string;
  timestamp: number;
  data: any;
}

// 工具调用信息
interface ToolCall {
  id: string;
  name: string;
  args: any;
  result?: any;
  status: 'pending' | 'running' | 'complete' | 'error';
  startTime: number;
  endTime?: number;
}

// Agent状态
interface AgentState {
  status: 'idle' | 'running' | 'complete' | 'error';
  currentNode: string | null;
  toolCalls: ToolCall[];
  events: AGUIEvent[];
  progress: {
    chaptersWritten: number;
    totalChapters: number;
    currentStep: string;
    outlineDone: boolean;
  };
}

// ── 图结构面板（从/api/graph动态加载） ──

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
        title: n.desc, // tooltip
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

    // 重置所有节点
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

    // 高亮活跃节点
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

// ── 从AG-UI事件中提取工具调用信息 ──

function extractToolCalls(events: AGUIEvent[]): ToolCall[] {
  const toolCalls: Map<string, ToolCall> = new Map();

  for (const evt of events) {
    const d = evt.data;

    if (d.type === 'TOOL_CALL_START') {
      toolCalls.set(d.toolCallId || evt.timestamp.toString(), {
        id: d.toolCallId || evt.timestamp.toString(),
        name: d.toolName || d.name || 'unknown',
        args: d.args,
        status: 'running',
        startTime: evt.timestamp,
      });
    }

    if (d.type === 'TOOL_CALL_END') {
      const id = d.toolCallId || '';
      if (toolCalls.has(id)) {
        const tc = toolCalls.get(id)!;
        tc.status = 'complete';
        tc.endTime = evt.timestamp;
        tc.result = d.result;
      }
    }

    if (d.type === 'RAW' && d.event) {
      const raw = d.event;
      if (raw.event === 'on_tool_start') {
        const id = raw.run_id || evt.timestamp.toString();
        toolCalls.set(id, {
          id,
          name: raw.name || 'unknown',
          args: raw.data?.input,
          status: 'running',
          startTime: evt.timestamp,
        });
      }
      if (raw.event === 'on_tool_end') {
        for (const [, tc] of toolCalls) {
          if (tc.status === 'running' && tc.name === raw.name) {
            tc.status = 'complete';
            tc.endTime = evt.timestamp;
            tc.result = raw.data?.output;
            break;
          }
        }
      }
    }
  }

  return Array.from(toolCalls.values());
}

// ── 从事件中提取当前活跃的pipeline节点 ──

function extractActiveNode(events: AGUIEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const d = events[i].data;
    if (d.type === 'node_start' && d.node_id) return d.node_id;
    if (d.type === 'node_end') continue;
    if (d.type === 'STEP_STARTED' && d.stepName) return d.stepName;
    if (d.type === 'RUN_STARTED') return 'agent';
  }
  return null;
}

// ── 构建节点执行历史 ──

// ── AgentDashboard ──

export function AgentDashboard({ runtimeUrl }: { runtimeUrl: string }) {
  const [state, setState] = useState<AgentState>({
    status: 'idle',
    currentNode: null,
    toolCalls: [],
    events: [],
    progress: {
      chaptersWritten: 0,
      totalChapters: 0,
      currentStep: '',
      outlineDone: false,
    },
  });
  const [isConnected, setIsConnected] = useState(false);
  const [nodeHistory, setNodeHistory] = useState<Record<string, { count: number; lastMsg: string; messages: string[] }>>({});
  const containerRef = useRef<HTMLDivElement>(null);
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
          const newEvents = data.events || [];
          if (newEvents.length > 0) {
            lastPollRef.current = newEvents[newEvents.length - 1].timestamp;
            setState(prev => {
              const allEvents = [...prev.events, ...newEvents.map((e: any) => ({
                type: e.type,
                timestamp: e.timestamp * 1000,
                data: e.data,
              }))].slice(-500);

              let newStatus = prev.status;
              for (const evt of newEvents) {
                if (evt.type === 'RUN_STARTED' || evt.type === 'run_start') newStatus = 'running';
                else if (evt.type === 'RUN_FINISHED' || evt.type === 'run_end') newStatus = 'complete';
                else if (evt.type === 'RUN_ERROR' || evt.type === 'run_error') newStatus = 'error';
              }

              // Extract progress from events
              let chaptersWritten = prev.progress.chaptersWritten;
              let totalChapters = prev.progress.totalChapters;
              let currentStep = prev.progress.currentStep;
              let outlineDone = prev.progress.outlineDone;
              for (const evt of newEvents) {
                const d = evt.data;
                const msg = d.message || '';
                // Detect outline completion
                if (d.type === 'STEP_FINISHED' && msg.includes('大纲')) {
                  outlineDone = true;
                }
                // Detect chapter writes
                if ((d.type === 'STEP_FINISHED' || d.type === 'node_end') && (msg.includes('章节') || msg.includes('章写'))) {
                  chaptersWritten++;
                }
                // Detect total chapters from outline
                if (d.type === 'STEP_FINISHED' && msg.includes('章')) {
                  const match = msg.match(/(\d+)\s*章/);
                  if (match) totalChapters = Math.max(totalChapters, parseInt(match[1]));
                }
                // Track current step
                if (d.type === 'STEP_STARTED' || d.type === 'node_start') {
                  currentStep = d.stepName || d.node_id || d.message || '';
                }
              }

              return {
                ...prev,
                status: newStatus,
                currentNode: extractActiveNode(allEvents),
                toolCalls: extractToolCalls(allEvents),
                events: allEvents,
                progress: { chaptersWritten, totalChapters, currentStep, outlineDone },
              };
            });

            setNodeHistory(prev => {
              const updated = { ...prev };
              for (const evt of newEvents) {
                const d = evt.data;
                const nodeId = d.node_id || d.stepName;
                if (!nodeId) continue;
                if (!updated[nodeId]) {
                  updated[nodeId] = { count: 0, lastMsg: '', messages: [] };
                }
                if (d.type === 'node_start' || d.type === 'STEP_STARTED') {
                  updated[nodeId].count++;
                  updated[nodeId].lastMsg = d.message || '';
                  updated[nodeId].messages.push(d.message || '开始执行');
                }
                if (d.type === 'node_end' || d.type === 'STEP_FINISHED') {
                  updated[nodeId].messages.push(d.message || '执行完成');
                }
                if (d.type === 'state_update') {
                  updated[nodeId].messages.push(d.message || '');
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
    setState(prev => ({
      ...prev,
      events: [],
      toolCalls: [],
      currentNode: null,
      progress: { chaptersWritten: 0, totalChapters: 0, currentStep: '', outlineDone: false },
    }));
    setNodeHistory({});
  };

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [state.events]);

  return (
    <div className="agent-dashboard">
      <div className="dashboard-header">
        <h3>🔍 Agent 监控</h3>
        {/* Progress indicator */}
        {state.status === 'running' && (
          <div className="progress-indicator">
            <div className="progress-bar-container">
              <div
                className="progress-bar-fill"
                style={{
                  width: state.progress.totalChapters > 0
                    ? `${Math.min((state.progress.chaptersWritten / state.progress.totalChapters) * 100, 100)}%`
                    : state.progress.outlineDone ? '30%' : '10%',
                }}
              />
            </div>
            <span className="progress-text">
              {state.progress.currentStep && `📝 ${state.progress.currentStep}`}
              {state.progress.totalChapters > 0 && ` · ${state.progress.chaptersWritten}/${state.progress.totalChapters} 章`}
            </span>
          </div>
        )}
        <div className="dashboard-controls">
          <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? '● 已连接' : '○ 未连接'}
          </span>
          <button className="btn-clear" onClick={clearEvents}>🗑</button>
        </div>
      </div>

      {/* Agent 循环图 */}
      <PipelineGraphPanel activeNode={state.currentNode} nodeHistory={nodeHistory} />

      {/* 状态指示 */}
      <div className="graph-status">
        <span className={`status-dot ${state.status}`} />
        <span className="status-text">
          {state.status === 'idle' && '等待任务'}
          {state.status === 'running' && `执行中... 当前节点: ${state.currentNode || '-'}`}
          {state.status === 'complete' && '已完成'}
          {state.status === 'error' && '出错'}
        </span>
      </div>

      {/* 工具调用记录 */}
      {state.toolCalls.length > 0 && (
        <div className="tool-history">
          <h4>🔧 工具调用 ({state.toolCalls.length})</h4>
          {state.toolCalls.slice(-8).map(tc => (
            <div key={tc.id} className={`tool-history-item ${tc.status}`}>
              <span className="tool-history-icon">
                {tc.status === 'running' ? '🔄' : tc.status === 'complete' ? '✅' : '❌'}
              </span>
              <span className="tool-history-name">{tc.name}</span>
              {tc.endTime && (
                <span className="tool-history-time">{((tc.endTime - tc.startTime) / 1000).toFixed(1)}s</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 事件流 */}
      <div className="events-section" ref={containerRef}>
        <h4>📡 事件流 ({state.events.length})</h4>
        <div className="events-list">
          {state.events.length === 0 ? (
            <div className="events-empty">
              {isConnected ? '等待事件...' : '未连接'}
            </div>
          ) : (
            state.events.slice(-30).map((event, i) => (
              <div key={i} className={`event-item ${event.data?.type || event.type}`}>
                <span className="event-time">
                  {new Date(event.timestamp).toLocaleTimeString()}
                </span>
                <span className="event-type">{event.data?.node_id || event.data?.type || event.type}</span>
                <span className="event-msg">{event.data?.message || ''}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ETCLOVG 指标 */}
      <ETCLOVGPanel />

      <PDFDownloadPanel />
    </div>
  );
}

// ── ETCLOVG指标面板 ──

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

// ── PDF下载面板 ──

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
