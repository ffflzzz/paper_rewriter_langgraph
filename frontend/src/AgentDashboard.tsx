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

// ── 图结构面板 ──

function GraphPanel({ state }: { state: AgentState }) {
  const { status, currentNode, toolCalls } = state;
  const isRunning = status === 'running';
  const activeTool = toolCalls.find(tc => tc.status === 'running');

  const nodeClass = (name: string) => {
    if (!isRunning) return 'graph-node idle';
    if (currentNode === name || (name === 'tools' && activeTool)) return 'graph-node active';
    return 'graph-node idle';
  };

  return (
    <div className="graph-panel">
      <h3 className="graph-title">📊 Agent 流水线</h3>
      
      <div className="pipeline">
        <div className={`pipeline-node start ${isRunning ? 'active' : ''}`}>
          <span className="node-icon">▶</span>
          <span className="node-label">START</span>
        </div>
        <div className={`pipeline-arrow ${isRunning ? 'flowing' : ''}`} />

        <div className={nodeClass('agent')}>
          <span className="node-icon">🤖</span>
          <span className="node-label">Agent</span>
          <span className="node-detail">MiMo v2.5 Pro</span>
          {currentNode === 'agent' && isRunning && <span className="pulse" />}
        </div>
        <div className={`pipeline-arrow ${activeTool ? 'flowing' : ''}`} />

        <div className={nodeClass('tools')}>
          <span className="node-icon">🔧</span>
          <span className="node-label">Tools</span>
          <span className="node-detail">
            {activeTool ? activeTool.name : toolCalls.length > 0 ? `${toolCalls.length} 次调用` : '9 个工具'}
          </span>
          {activeTool && <span className="pulse" />}
        </div>
      </div>

      {/* 当前工具调用详情 */}
      {activeTool && (
        <div className="active-tool-card">
          <div className="tool-card-header">
            <span className="tool-card-icon">⚡</span>
            <span className="tool-card-name">{activeTool.name}</span>
            <span className="tool-card-status running">执行中...</span>
          </div>
          {activeTool.args && (
            <pre className="tool-card-args">{JSON.stringify(activeTool.args, null, 2)}</pre>
          )}
        </div>
      )}

      {/* 工具调用历史 */}
      {toolCalls.length > 0 && (
        <div className="tool-history">
          <h4>调用记录</h4>
          {toolCalls.slice(-5).map(tc => (
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

      {/* 状态指示 */}
      <div className="graph-status">
        <span className={`status-dot ${status}`} />
        <span className="status-text">
          {status === 'idle' && '等待任务'}
          {status === 'running' && '执行中...'}
          {status === 'complete' && '已完成'}
          {status === 'error' && '出错'}
        </span>
      </div>
    </div>
  );
}

// ── 从AG-UI事件中提取工具调用信息 ──

function extractToolCalls(events: AGUIEvent[]): ToolCall[] {
  const toolCalls: Map<string, ToolCall> = new Map();
  
  for (const evt of events) {
    const d = evt.data;
    
    // AG-UI TOOL_CALL_START
    if (d.type === 'TOOL_CALL_START') {
      toolCalls.set(d.toolCallId || evt.timestamp.toString(), {
        id: d.toolCallId || evt.timestamp.toString(),
        name: d.toolName || d.name || 'unknown',
        args: d.args,
        status: 'running',
        startTime: evt.timestamp,
      });
    }
    
    // AG-UI TOOL_CALL_END
    if (d.type === 'TOOL_CALL_END') {
      const id = d.toolCallId || '';
      if (toolCalls.has(id)) {
        const tc = toolCalls.get(id)!;
        tc.status = 'complete';
        tc.endTime = evt.timestamp;
        tc.result = d.result;
      }
    }
    
    // RAW事件中的LangGraph tool调用（on_tool_start / on_tool_end）
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

// ── 从AG-UI事件中提取当前节点 ──

function extractCurrentNode(events: AGUIEvent[]): string | null {
  // 从后往前找最近的STEP事件
  for (let i = events.length - 1; i >= 0; i--) {
    const d = events[i].data;
    if (d.type === 'STEP_STARTED') return d.stepName || 'agent';
    if (d.type === 'STEP_FINISHED') return null;
    if (d.type === 'RUN_STARTED') return 'agent';
    if (d.type === 'RUN_FINISHED' || d.type === 'RUN_ERROR') return null;
    
    // RAW事件中的LangGraph节点信息
    if (d.type === 'RAW' && d.event) {
      const raw = d.event;
      if (raw.event === 'on_chain_start' && raw.name !== 'LangGraph') {
        return raw.name;
      }
    }
  }
  return null;
}

// ── AgentDashboard ──

export function AgentDashboard({ runtimeUrl }: { runtimeUrl: string }) {
  const [state, setState] = useState<AgentState>({
    status: 'idle',
    currentNode: null,
    toolCalls: [],
    events: [],
  });
  const [isConnected, setIsConnected] = useState(false);
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
              }))].slice(-200);
              
              let newStatus = prev.status;
              for (const evt of newEvents) {
                if (evt.type === 'RUN_STARTED') newStatus = 'running';
                else if (evt.type === 'RUN_FINISHED') newStatus = 'complete';
                else if (evt.type === 'RUN_ERROR') newStatus = 'error';
              }

              return {
                ...prev,
                status: newStatus,
                currentNode: extractCurrentNode(allEvents),
                toolCalls: extractToolCalls(allEvents),
                events: allEvents,
              };
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
    setState(prev => ({ ...prev, events: [], toolCalls: [] }));
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

      <GraphPanel state={state} />

      <div className="events-section" ref={containerRef}>
        <h4>📡 事件流 ({state.events.length})</h4>
        <div className="events-list">
          {state.events.length === 0 ? (
            <div className="events-empty">
              {isConnected ? '等待事件...' : '未连接'}
            </div>
          ) : (
            state.events.slice(-20).map((event, i) => (
              <div key={i} className={`event-item ${event.type}`}>
                <span className="event-time">
                  {new Date(event.timestamp).toLocaleTimeString()}
                </span>
                <span className="event-type">{event.type}</span>
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
