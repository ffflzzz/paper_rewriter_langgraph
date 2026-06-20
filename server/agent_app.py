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
}

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
    app.mount("/assets", StaticFiles(directory=os.path.join(_frontend_dist, "assets")), name="frontend-assets")


class RunRequest(BaseModel):
    paper_title: str
    original_text: str
    target_audience: str = "大一非理工科学生"
    max_tool_calls: int = 200


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
    })

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
    return {"status": "stopped"}


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
        # 初始化run目录
        set_current_run_id(run_id)
        init_run(run_id, original_text, paper_title=paper_title)

        # 构建图
        graph = build_agent_graph()

        # 初始消息
        first_message = f"请开始重写论文《{paper_title}》。目标读者：{target_audience}。原文长度：{len(original_text)}字。先浏览原文结构，然后生成大纲。"

        tool_call_count = 0

        # 用stream逐步执行，实时推送事件
        for event in graph.stream(
            {"messages": [HumanMessage(content=first_message)]},
            {"recursion_limit": max_tool_calls * 2},
            stream_mode="updates",
        ):
            if current_run["status"] == "stopped":
                _log(f"[Agent {run_id}] 用户停止")
                break

            for node_name, node_output in event.items():
                _log(f"[Agent {run_id}] {node_name}")

                msgs = node_output.get("messages", [])
                for msg in msgs:
                    # AIMessage with tool_calls
                    if isinstance(msg, AIMessage) and msg.tool_calls:
                        for tc in msg.tool_calls:
                            tool_call_count += 1
                            current_run["tool_calls"] = tool_call_count
                            current_run["last_action"] = f"调用 {tc['name']}"
                            _fire_sse("tool_call", {
                                "run_id": run_id,
                                "tool": tc["name"],
                                "args": str(tc["args"])[:200],
                                "count": tool_call_count,
                            })
                    
                    # AIMessage with content (agent's text response)
                    elif isinstance(msg, AIMessage) and msg.content:
                        current_run["last_action"] = msg.content[:200]
                        _fire_sse("agent_message", {
                            "run_id": run_id,
                            "content": msg.content[:500],
                        })
                    
                    # ToolMessage (tool result)
                    elif isinstance(msg, ToolMessage):
                        _fire_sse("tool_result", {
                            "run_id": run_id,
                            "result": str(msg.content)[:300],
                        })

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
