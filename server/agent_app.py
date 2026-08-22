"""FastAPI 服务器 — Agent 架构版（最新LangGraph）

运行: python -m server.agent_app
或:   uvicorn server.agent_app:app --host 0.0.0.0 --port 8765
"""
from __future__ import annotations
import asyncio
import json
import os
import sys
import threading
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sse_starlette.sse import EventSourceResponse
from pydantic import BaseModel

# 确保项目根目录在path中
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from agent.graph import build_agent_graph, set_current_run_id, init_run, _get_run_dir, _log
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage, SystemMessage
from langgraph.types import Command
from pipeline.config import SERVER_HOST, SERVER_PORT, OUTPUT_DIR

# ─── 全局状态 ───
current_run: dict = {
    "run_id": None,
    "status": "idle",
    "started_at": None,
    "ended_at": None,
    "error": "",
    "tool_calls": 0,
    "last_action": "",
    "auto_approve": False,
    "awaiting": None,   # HITL 挂起信息：{tool, reason, args}
}

# HITL 决策通道：运行线程在此等待，resume 端点注入决策值
_resume_event: threading.Event = threading.Event()
_resume_value: list = [True]

_sse_queues: list = []


def _fire_sse(event_type: str, data: dict):
    payload = json.dumps(data, ensure_ascii=False)
    for q in _sse_queues:
        try:
            q.put_nowait({"event": event_type, "data": payload})
        except Exception:
            pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    yield


app = FastAPI(
    title="论文重写 Agent Dashboard",
    version="2.0.0",
    lifespan=lifespan,
)

# 静态文件
_ui_dir = os.path.join(_PROJECT_ROOT, "ui")
if os.path.exists(_ui_dir):
    app.mount("/ui", StaticFiles(directory=_ui_dir), name="ui")

_frontend_dist = os.path.join(_PROJECT_ROOT, "frontend", "dist")
if os.path.exists(_frontend_dist):
    # 构建产物可能全部内联进 index.html（CDN React + 浏览器内 Babel），assets 目录不一定存在
    _assets_dir = os.path.join(_frontend_dist, "assets")
    if os.path.isdir(_assets_dir):
        app.mount("/assets", StaticFiles(directory=_assets_dir), name="frontend-assets")


class RunRequest(BaseModel):
    paper_title: str
    original_text: str = ""  # 可选：为空时 Agent 自动搜索并下载论文
    target_audience: str = "大一非理工科学生"
    max_tool_calls: int = 200
    auto_approve: bool = False  # True=全自动（HITL 中断自动批准）；False=每步等人工确认


class ResumeRequest(BaseModel):
    # True/False = 批准/跳过；字符串 = 批准并捎话给 Agent（成为工具返回值进入其上下文）
    decision: bool | str = True


from fastapi import UploadFile, File as FastAPIFile


@app.post("/api/upload")
async def upload_file(file: UploadFile = FastAPIFile(...)):
    """上传文件（PDF/TXT），提取文本"""
    import tempfile
    content = await file.read()
    suffix = os.path.splitext(file.filename or "")[1].lower()
    text = ""

    if suffix in (".txt", ".md"):
        text = content.decode("utf-8", errors="ignore")
    elif suffix == ".pdf":
        try:
            import fitz
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(content)
                tmp_path = tmp.name
            doc = fitz.open(tmp_path)
            text = "\n".join(page.get_text() for page in doc)
            doc.close()
            os.unlink(tmp_path)
        except ImportError:
            return JSONResponse({"error": "需要安装pymupdf: pip install pymupdf"}, status_code=500)
        except Exception as e:
            return JSONResponse({"error": f"PDF解析失败: {e}"}, status_code=400)
    else:
        return JSONResponse({"error": f"不支持的文件格式: {suffix}"}, status_code=400)

    return {"filename": file.filename, "text": text, "chars": len(text)}


@app.get("/", response_class=HTMLResponse)
async def index():
    react_index = os.path.join(_PROJECT_ROOT, "frontend", "dist", "index.html")
    if os.path.exists(react_index):
        with open(react_index, "r", encoding="utf-8") as f:
            return HTMLResponse(f.read())
    ui_path = os.path.join(_PROJECT_ROOT, "ui", "index.html")
    with open(ui_path, "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())


@app.get("/api/graph")
async def get_graph_definition():
    return {
        "nodes": [
            {"id": "agent", "label": "Agent LLM", "type": "process"},
            {"id": "tools", "label": "ToolNode", "type": "process"},
        ],
        "edges": [
            {"from": "__start__", "to": "agent", "label": ""},
            {"from": "agent", "to": "tools", "label": "有tool_call"},
            {"from": "agent", "to": "__end__", "label": "无tool_call"},
            {"from": "tools", "to": "agent", "label": "返回结果"},
        ],
    }


@app.get("/api/status")
async def get_status():
    chapters_info = {}
    run_id = current_run.get("run_id")
    if run_id:
        run_dir = _get_run_dir(run_id)
        progress_path = os.path.join(run_dir, "progress.json")
        if os.path.exists(progress_path):
            with open(progress_path, "r", encoding="utf-8") as f:
                chapters_info = json.load(f).get("chapters", {})

    return {
        "run_id": current_run["run_id"],
        "status": current_run["status"],
        "started_at": current_run["started_at"],
        "ended_at": current_run["ended_at"],
        "error": current_run.get("error", ""),
        "tool_calls": current_run.get("tool_calls", 0),
        "last_action": current_run.get("last_action", ""),
        "auto_approve": current_run.get("auto_approve", False),
        "awaiting": current_run.get("awaiting"),
        "chapters": chapters_info,
    }


@app.get("/api/runs")
async def list_runs():
    runs_dir = os.path.join(_PROJECT_ROOT, "runs")
    if not os.path.exists(runs_dir):
        return []
    
    runs = []
    for name in sorted(os.listdir(runs_dir), reverse=True):
        run_dir = os.path.join(runs_dir, name)
        if not os.path.isdir(run_dir):
            continue
        
        meta = {}
        progress = {}
        
        meta_path = os.path.join(run_dir, "meta.json")
        progress_path = os.path.join(run_dir, "progress.json")
        
        if os.path.exists(meta_path):
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
        if os.path.exists(progress_path):
            with open(progress_path, "r", encoding="utf-8") as f:
                progress = json.load(f)
        
        chapters = progress.get("chapters", {})
        total_chars = sum(ch.get("chars", 0) for ch in chapters.values())
        
        runs.append({
            "run_id": name,
            "paper_title": meta.get("paper_title", ""),
            "original_chars": meta.get("original_chars", 0),
            "chapters_written": len(chapters),
            "total_chars": total_chars,
            "created_at": meta.get("created_at", 0),
        })
    
    return runs


@app.post("/api/run")
async def start_run(req: RunRequest):
    if current_run["status"] == "running":
        return JSONResponse({"error": "Agent 正在运行中"}, status_code=409)

    run_id = str(uuid.uuid4())[:8]
    current_run.update({
        "run_id": run_id,
        "status": "running",
        "error": "",
        "started_at": time.time(),
        "ended_at": None,
        "tool_calls": 0,
        "last_action": "启动中...",
        "auto_approve": req.auto_approve,
        "awaiting": None,
    })
    _resume_event.clear()

    thread = threading.Thread(
        target=_run_agent,
        args=(run_id, req.paper_title, req.original_text, req.target_audience, req.max_tool_calls),
        daemon=True,
    )
    thread.start()

    return {"run_id": run_id, "status": "started"}


@app.post("/api/stop")
async def stop_run():
    current_run["status"] = "stopped"
    current_run["ended_at"] = time.time()
    # 若正卡在 HITL 等待，注入 False 解除阻塞，运行线程随即退出
    if current_run.get("awaiting"):
        _resume_value[0] = False
        _resume_event.set()
    return {"status": "stopped"}


@app.post("/api/runs/{run_id}/resume")
async def resume_run(run_id: str, req: ResumeRequest):
    """人工决策：批准/跳过当前挂起的 HITL 中断；字符串则作为指示捎给 Agent"""
    if current_run.get("run_id") != run_id:
        return JSONResponse({"error": "run_id 不匹配"}, status_code=409)
    if not current_run.get("awaiting"):
        return JSONResponse({"error": "当前没有挂起的人工确认"}, status_code=409)

    _resume_value[0] = req.decision
    current_run["awaiting"] = None
    _resume_event.set()
    return {"status": "resumed", "decision": req.decision if isinstance(req.decision, bool) else "instructed"}


@app.get("/api/events")
async def event_stream(request: Request):
    queue: asyncio.Queue = asyncio.Queue()
    _sse_queues.append(queue)

    async def generate():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    evt = await asyncio.wait_for(queue.get(), timeout=30)
                    yield evt
                except asyncio.TimeoutError:
                    yield {"event": "heartbeat", "data": "{}"}
        finally:
            if queue in _sse_queues:
                _sse_queues.remove(queue)

    return EventSourceResponse(generate())


@app.get("/api/chapter/{run_id}/{chapter_id}")
async def get_chapter(run_id: str, chapter_id: str):
    chapter_path = os.path.join(_get_run_dir(run_id), "chapters", f"{chapter_id}.txt")
    if not os.path.exists(chapter_path):
        return JSONResponse({"error": f"{chapter_id} 不存在"}, status_code=404)
    with open(chapter_path, "r", encoding="utf-8") as f:
        content = f.read()
    return {"chapter_id": chapter_id, "content": content, "chars": len(content)}


@app.get("/api/output/{filename}")
async def get_output_file(filename: str):
    from fastapi.responses import FileResponse
    path = os.path.join(OUTPUT_DIR, filename)
    if os.path.exists(path):
        return FileResponse(path)
    return JSONResponse({"error": "文件不存在"}, status_code=404)


# ─── Agent 运行器 ───

def _run_agent(run_id: str, paper_title: str, original_text: str,
               target_audience: str, max_tool_calls: int):
    """在后台线程中执行 LangGraph Agent（最新架构）"""
    _log(f"[Agent {run_id}] 启动，原文{len(original_text)}字")
    _fire_sse("agent_start", {"run_id": run_id, "paper_title": paper_title})

    try:
        # 初始化run目录（原文为空时跳过写入，由 Agent 自行检索下载）
        set_current_run_id(run_id)
        init_run(run_id, original_text, paper_title=paper_title)

        # 构建图
        graph = build_agent_graph()

        # 初始消息：提供了原文 → 直接浏览重写；未提供 → 让 Agent 自己搜索下载
        if original_text.strip():
            first_message = (
                f"请开始重写论文《{paper_title}》。目标读者：{target_audience}。"
                f"原文长度：{len(original_text)}字。先浏览原文结构，然后生成大纲，逐章写作，最后生成PDF。"
            )
        else:
            first_message = (
                f"用户只提供了论文标题《{paper_title}》，没有提供原文。"
                f"请先用 search_paper 工具搜索这篇论文（目标读者：{target_audience}），"
                "从结果中选择标题最匹配的一篇，用 download_paper 下载（它会自动提取全文并保存）；"
                "然后浏览原文、生成大纲、逐章写作，最后 generate_pdf。现在开始。"
            )

        tool_call_count = 0

        config = {
            "configurable": {"thread_id": run_id},
            "recursion_limit": max_tool_calls * 2,
        }

        def extract_interrupt_info() -> dict:
            """从图检查点状态提取挂起中断的详情（供审批卡展示）"""
            try:
                snap = graph.get_state(config)
                for t in getattr(snap, "tasks", []) or []:
                    its = getattr(t, "interrupts", None)
                    if its:
                        val = getattr(its[0], "value", None)
                        if isinstance(val, dict):
                            return {
                                "tool": str(val.get("tool", "")),
                                "reason": str(val.get("reason", "")),
                                "args": json.dumps(val.get("args", {}), ensure_ascii=False)[:400],
                            }
            except Exception as e:
                _log(f"[Agent {run_id}] 提取中断信息失败: {e}")
            return {"tool": "?", "reason": "工具执行前等待确认", "args": ""}

        def consume(stream_iter) -> bool:
            """消费一个 stream；返回是否以中断收尾"""
            nonlocal tool_call_count
            pending = False
            for event in stream_iter:
                if current_run["status"] == "stopped":
                    return False
                for node_name, node_output in event.items():
                    _log(f"[Agent {run_id}] {node_name}")
                    if node_name == "__interrupt__":
                        pending = True
                        continue
                    if not isinstance(node_output, dict):
                        continue
                    for msg in node_output.get("messages", []):
                        if isinstance(msg, AIMessage):
                            # 思考文本与工具调用可并存于同一条 AIMessage：都推送
                            if msg.content:
                                current_run["last_action"] = str(msg.content)[:200]
                                _fire_sse("agent_message", {
                                    "run_id": run_id,
                                    "content": str(msg.content)[:2000],
                                })
                            for tc in msg.tool_calls or []:
                                tool_call_count += 1
                                current_run["tool_calls"] = tool_call_count
                                current_run["last_action"] = f"调用 {tc['name']}"
                                _fire_sse("tool_call", {
                                    "run_id": run_id,
                                    "tool": tc["name"],
                                    "args": str(tc.get("args", ""))[:500],
                                    "count": tool_call_count,
                                })
                        elif isinstance(msg, ToolMessage):
                            _fire_sse("tool_result", {
                                "run_id": run_id,
                                "result": str(msg.content)[:800],
                            })
                        elif isinstance(msg, HumanMessage) and str(msg.content).startswith("[用户指示]"):
                            _fire_sse("agent_message", {
                                "run_id": run_id,
                                "content": str(msg.content),
                            })
            return pending

        # 主循环 + HITL 中断处理：
        #   auto_approve=True  → 自动批准（全自动模式）
        #   auto_approve=False → 推送审批卡，阻塞等待 /api/runs/{id}/resume 的人工决策
        pending = consume(graph.stream(
            {"messages": [HumanMessage(content=first_message)]}, config, stream_mode="updates",
        ))
        resumes = 0
        while pending and current_run["status"] == "running":
            resumes += 1
            info = extract_interrupt_info()
            if current_run.get("auto_approve"):
                decision: bool | str = True
                _log(f"[Agent {run_id}] 自动批准 HITL 中断 #{resumes}")
            else:
                current_run["awaiting"] = info
                _fire_sse("interrupt", {"run_id": run_id, **info})
                _log(f"[Agent {run_id}] HITL 等待人工决策 #{resumes}: {info.get('tool')}")
                _resume_event.clear()
                _resume_event.wait()          # 阻塞直至人工决策 / 停止注入解除
                decision = _resume_value[0]
                current_run["awaiting"] = None
                if current_run["status"] != "running":
                    break
                if isinstance(decision, bool):
                    _log(f"[Agent {run_id}] HITL 决策 #{resumes}: {'批准' if decision else '跳过'}")
                else:
                    _log(f"[Agent {run_id}] HITL 决策 #{resumes}: 批准并附指示（{len(decision)}字）")
            pending = consume(graph.stream(Command(resume=decision), config, stream_mode="updates"))

        if current_run["status"] != "stopped":
            current_run["status"] = "completed"

        # 读取最终章节信息
        run_dir = _get_run_dir(run_id)
        progress_path = os.path.join(run_dir, "progress.json")
        chapters_info = {}
        if os.path.exists(progress_path):
            with open(progress_path, "r", encoding="utf-8") as f:
                chapters_info = json.load(f).get("chapters", {})

        _fire_sse("agent_complete", {
            "run_id": run_id,
            "tool_calls": tool_call_count,
            "chapters": chapters_info,
        })
        _log(f"[Agent {run_id}] 完成，{tool_call_count}次工具调用，{len(chapters_info)}章")

    except Exception as e:
        current_run["status"] = "error"
        current_run["error"] = str(e)
        _log(f"[Agent {run_id}] 错误: {e}")
        import traceback
        _log(traceback.format_exc())
        _fire_sse("agent_error", {"run_id": run_id, "error": str(e)})

    finally:
        current_run["ended_at"] = time.time()


if __name__ == "__main__":
    import uvicorn
    print(f"🚀 论文重写 Agent Dashboard (LangGraph 最新架构)")
    print(f"   地址: http://localhost:{SERVER_PORT}")
    uvicorn.run(app, host=SERVER_HOST, port=SERVER_PORT)
