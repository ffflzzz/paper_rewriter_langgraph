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
}

// ── Pipeline图结构面板（vis.js） ──

function PipelineGraphPanel({ activeNode, nodeHistory }: {
  activeNode: string | null;
  nodeHistory: Record<string, { count: number; lastMsg: string }>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<any>(null);
  const nodesRef = useRef<any>(null);
  const edgesRef = useRef<any>(null);

  // 初始化vis.js图
  useEffect(() => {
    if (!containerRef.current) return;

    // 动态加载vis.js
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js';
    script.onload = () => {
      const vis = (window as any).vis;
      if (!vis || !containerRef.current) return;

      const nodeDefs = [
        { id: '__start__', label: '开始', type: 'start' },
        { id: 'outline_generator', label: '大纲生成', type: 'process' },
        { id: 'writer', label: '章节写作', type: 'process' },
        { id: 'reviewer', label: '质量审查', type: 'process' },
        { id: 'fact_checker', label: '事实核查', type: 'process' },
        { id: 'judge', label: '裁判判定', type: 'decision' },
        { id: 'pdf_generator', label: 'PDF生成', type: 'end' },
        { id: '__end__', label: '结束', type: 'end' },
      ];

      const COLORS: Record<string, { background: string; border: string }> = {
        start: { background: '#1a3a2a', border: '#3fb950' },
        process: { background: '#1a2a3a', border: '#58a6ff' },
        decision: { background: '#3a2a1a', border: '#d29922' },
        end: { background: '#2a1a1a', border: '#f85149' },
      };

      const nodes = new vis.DataSet(nodeDefs.map(n => ({
        id: n.id,
        label: n.label,
        shape: n.id === '__start__' || n.id === '__end__' ? 'dot' : 'box',
        size: n.id === '__start__' || n.id === '__end__' ? 16 : undefined,
        margin: 14,
        font: { color: '#e6e6e6', size: 13 },
        color: COLORS[n.type] || COLORS.process,
        borderWidth: 2,
        borderRadius: 6,
      })));

      const edgeDefs = [
        { from: '__start__', to: 'outline_generator', label: '' },
        { from: 'outline_generator', to: 'writer', label: '大纲完成' },
        { from: 'writer', to: 'reviewer', label: '写作完成' },
        { from: 'reviewer', to: 'fact_checker', label: '审查完成' },
        { from: 'fact_checker', to: 'judge', label: '核查完成' },
        { from: 'judge', to: 'writer', label: 'FAIL: 重写' },
        { from: 'judge', to: 'pdf_generator', label: 'PASS' },
        { from: 'pdf_generator', to: '__end__', label: '' },
      ];

      const edges = new vis.DataSet(edgeDefs.map(e => ({
        from: e.from,
        to: e.to,
        label: e.label,
        arrows: 'to',
        font: { color: '#8b949e', size: 10, strokeWidth: 0 },
        color: { color: '#484f58', highlight: '#58a6ff', inherit: 'both' },
        smooth: { type: 'cubicBezier' },
        width: 1.5,
      })));

      nodesRef.current = nodes;
      edgesRef.current = edges;

      networkRef.current = new vis.Network(containerRef.current, { nodes, edges }, {
        physics: false,
        interaction: { dragNodes: false, zoomView: true, dragView: true },
        layout: { improvedLayout: true },
      });
    };
    document.head.appendChild(script);

    return () => {
      if (networkRef.current) {
        networkRef.current.destroy();
        networkRef.current = null;
      }
    };
  }, []);

  // 高亮活跃节点
  useEffect(() => {
    const nodes = nodesRef.current;
    const network = networkRef.current;
    if (!nodes || !network) return;

    // 重置所有节点样式
    const allNodes = nodes.getIds();
    for (const nid of allNodes) {
      const hist = nodeHistory[nid];
      const execLabel = hist && hist.count > 0 ? ` (${hist.count}次)` : '';
      const origNode = [
        { id: '__start__', label: '开始' },
        { id: 'outline_generator', label: '大纲生成' },
        { id: 'writer', label: '章节写作' },
        { id: 'reviewer', label: '质量审查' },
        { id: 'fact_checker', label: '事实核查' },
        { id: 'judge', label: '裁判判定' },
        { id: 'pdf_generator', label: 'PDF生成' },
        { id: '__end__', label: '结束' },
      ].find(n => n.id === nid);

      nodes.update({
        id: nid,
        borderWidth: 2,
        shadow: { enabled: false },
        label: (origNode?.label || nid) + execLabel,
      });
    }

    // 高亮活跃节点
    if (activeNode && nodes.get(activeNode)) {
      nodes.update({
        id: activeNode,
        borderWidth: 4,
        shadow: { enabled: true, color: 'rgba(88,166,255,0.8)', size: 20 },
      });
      network.selectNodes([activeNode]);
      network.focus(activeNode, {
        scale: 1.2,
        animation: { duration: 500, easingFunction: 'easeInOutQuad' },
      });
    }
  }, [activeNode, nodeHistory]);

  return (
    <div className="pipeline-graph-container">
      <div ref={containerRef} style={{ width: '100%', height: '280px', background: '#0d1117', borderRadius: '8px' }} />
    </div>
  );
}

// ── 节点详情面板 ──

function NodeDetailPanel({ nodeId, nodeHistory }: {
  nodeId: string | null;
  nodeHistory: Record<string, { count: number; lastMsg: string; messages: string[] }>;
}) {
  if (!nodeId) {
    return <div className="node-detail-empty">点击图中节点查看详情</div>;
  }
  const hist = nodeHistory[nodeId];
  if (!hist || hist.count === 0) {
    return <div className="node-detail-empty">节点 [{nodeId}] — 尚未执行</div>;
  }
  return (
    <div className="node-detail-panel">
      <div className="node-detail-title">节点 [{nodeId}] — 执行 {hist.count} 次</div>
      <div className="node-detail-messages">
        {hist.messages.slice(-5).map((msg, i) => (
          <div key={i} className="node-detail-msg">{msg}</div>
        ))}
      </div>
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

// ── 从事件中提取当前活跃的agent节点 ──

function extractActiveNode(events: AGUIEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const d = events[i].data;
    // pipeline事件格式
    if (d.type === 'node_start' && d.node_id) return d.node_id;
    if (d.type === 'node_end') continue; // node_end不设高亮，等下一个node_start
    // AG-UI格式
    if (d.type === 'STEP_STARTED' && d.stepName) return d.stepName;
    if (d.type === 'RUN_STARTED') return 'outline_generator';
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

              return {
                ...prev,
                status: newStatus,
                currentNode: extractActiveNode(allEvents),
                toolCalls: extractToolCalls(allEvents),
                events: allEvents,
              };
            });

            // 更新节点历史
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
    setState(prev => ({ ...prev, events: [], toolCalls: [], currentNode: null }));
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
        <div className="dashboard-controls">
          <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? '● 已连接' : '○ 未连接'}
          </span>
          <button className="btn-clear" onClick={clearEvents}>🗑</button>
        </div>
      </div>

      {/* Agent 图结构 */}
      <PipelineGraphPanel activeNode={state.currentNode} nodeHistory={nodeHistory} />

      {/* 节点详情 */}
      <NodeDetailPanel nodeId={state.currentNode} nodeHistory={nodeHistory} />

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

      <PDFDownloadPanel />
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
