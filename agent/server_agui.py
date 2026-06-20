"""论文重写 Agent — FastAPI 服务（AG-UI 版本）

保留原有API + 新增AG-UI端点

API:
  POST /api/run          — 启动一次论文重写（原有）
  GET  /api/status       — 当前运行状态（原有）
  GET  /api/events       — SSE事件流（原有）
  POST /api/stop         — 停止当前运行（原有）
  GET  /api/runs         — 历史run列表（原有）
  GET  /api/run/{id}     — 某次run的详情（原有）
  POST /api/copilotkit   — AG-UI端点（新增）
"""
import asyncio
import json
import os
import time
import uuid
from pathlib import Path
from typing import AsyncGenerator

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from .rewrite_graph import run_rewrite
from .state import RunState
from .graph import build_agent_graph

# AG-UI imports
from pathlib import Path
from fastapi.staticfiles import StaticFiles
from ag_ui_langgraph import LangGraphAgent, add_langgraph_fastapi_endpoint

app = FastAPI(title="论文重写 Agent")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# ── 状态 ──
RUNS_DIR = Path(__file__).parent.parent / "runs"
RUNS_DIR.mkdir(exist_ok=True)

current_run = {
    "run_id": None,
    "status": "idle",
    "started_at": None,
    "ended_at": None,
    "agent": None,
    "state": None,
    "task": None,
    "error": "",
}


class RunRequest(BaseModel):
    paper_title: str
    original_text: str = ""
    original_path: str = ""
    target_audience: str = "大一非理工科学生"
    language: str = "zh"
    max_rounds: int = 3


# ── 事件广播 ──
_event_queues: list[asyncio.Queue] = []


async def broadcast(event_type: str, data: dict):
    """广播事件给所有SSE客户端 + 写trace日志 + event_log"""
    from .event_log import log_event
    event = {"type": event_type, "ts": time.time(), **data}
    for q in _event_queues:
        await q.put(event)
    log_event(event_type, data)
    # 写本地trace
    if current_run["state"]:
        current_run["state"].log_event(event_type, data)


# ── Agent运行 ──

async def run_agent(req: RunRequest, run_id: str):
    """在后台线程中运行agent"""
    try:
        # 读取原文
        if req.original_path:
            original_text = Path(req.original_path).read_text(encoding="utf-8")
        else:
            original_text = req.original_text

        current_run["status"] = "running"
        current_run["started_at"] = time.time()
        current_run["run_id"] = run_id
        current_run["state"] = RunState(run_id)

        await broadcast("run_start", {"run_id": run_id, "title": req.paper_title})

        # 运行（在线程中执行同步代码）
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            lambda: run_rewrite(
                original_text=original_text,
                paper_title=req.paper_title,
                target_audience=req.target_audience,
                run_id=run_id,
                max_retries=req.max_rounds,
            ),
        )

        current_run["status"] = "completed"
        current_run["ended_at"] = time.time()
        await broadcast("run_end", {"run_id": run_id, "result": result})

    except Exception as e:
        current_run["status"] = "error"
        current_run["error"] = str(e)
        current_run["ended_at"] = time.time()
        await broadcast("run_error", {"run_id": run_id, "error": str(e)})


# ── 原有API端点 ──

@app.post("/api/run")
async def start_run(req: RunRequest):
    """启动一次论文重写"""
    if current_run["status"] == "running":
        return JSONResponse(status_code=409, content={"error": "已有任务在运行"})

    run_id = str(uuid.uuid4())[:8]
    task = asyncio.create_task(run_agent(req, run_id))
    current_run["task"] = task

    return {"run_id": run_id, "status": "started"}


@app.get("/api/status")
async def get_status():
    """获取当前状态"""
    return {
        "run_id": current_run["run_id"],
        "status": current_run["status"],
        "started_at": current_run["started_at"],
        "ended_at": current_run["ended_at"],
        "error": current_run["error"],
        "state": current_run["state"].to_dict() if current_run["state"] else None,
    }


# ── AG-UI事件日志（供Dashboard轮询） ──
from .event_log import log_event, get_events

@app.get("/api/event-log")
async def get_event_log(after: float = 0):
    """获取AG-UI事件日志（支持增量拉取）"""
    return {"events": get_events(after)}


@app.get("/api/events")
async def events():
    """SSE事件流"""
    queue: asyncio.Queue = asyncio.Queue()
    _event_queues.append(queue)

    async def event_generator():
        try:
            while True:
                event = await queue.get()
                yield f"data: {json.dumps(event)}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            _event_queues.remove(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/stop")
async def stop_run():
    """停止当前运行"""
    if current_run["task"] and not current_run["task"].done():
        current_run["task"].cancel()
        current_run["status"] = "stopped"
        current_run["ended_at"] = time.time()
        return {"status": "stopped"}
    return {"status": "no_active_run"}


@app.get("/api/runs")
async def list_runs():
    """列出所有历史run"""
    runs = []
    if RUNS_DIR.exists():
        for run_dir in sorted(RUNS_DIR.iterdir(), reverse=True):
            if run_dir.is_dir():
                meta_path = run_dir / "meta.json"
                if meta_path.exists():
                    meta = json.loads(meta_path.read_text())
                    runs.append(meta)
    return {"runs": runs}


@app.get("/api/run/{run_id}")
async def get_run(run_id: str):
    """获取某个run的详情"""
    run_dir = RUNS_DIR / run_id
    if not run_dir.exists():
        return JSONResponse(status_code=404, content={"error": "Run not found"})

    meta = {}
    meta_path = run_dir / "meta.json"
    if meta_path.exists():
        meta = json.loads(meta_path.read_text())

    progress = {}
    progress_path = run_dir / "progress.json"
    if progress_path.exists():
        progress = json.loads(progress_path.read_text())

    chapters = {}
    chapters_dir = run_dir / "chapters"
    if chapters_dir.exists():
        for f in sorted(chapters_dir.iterdir()):
            if f.suffix == ".txt":
                chapters[f.stem] = f.read_text(encoding="utf-8")

    return {"meta": meta, "progress": progress, "chapters": chapters}


# ── AG-UI 端点 ──

# 创建AG-UI agent（AsyncSqliteSaver for persistence）
import aiosqlite
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
import os

_db_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "checkpoints.db")
_checkpointer = None
_agui_agent = None

@app.on_event("startup")
async def init_checkpointer():
    global _checkpointer, _agui_agent
    conn = await aiosqlite.connect(_db_path)
    _checkpointer = AsyncSqliteSaver(conn)
    
    graph = build_agent_graph(checkpointer=_checkpointer)
    _agui_agent = LangGraphAgent(
        config={"recursion_limit": 500},
        name="paper_rewriter",
        graph=graph,
        description="论文重写多Agent系统：writer→reviewer→factchecker→judge循环",
    )
    add_langgraph_fastapi_endpoint(app, _agui_agent, path="/api/copilotkit")
    print(f"AG-UI initialized with AsyncSqliteSaver: {_db_path}")

    # 在AG-UI端点之后挂载静态文件，确保API路由优先级更高
    if FRONTEND_DIR.exists():
        app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")
        print(f"Static files served from: {FRONTEND_DIR}")


# ── 论文搜索API ──

@app.get("/api/search_paper")
async def search_paper_api(query: str, max_results: int = 3):
    """搜索论文API"""
    from .paper_search import search_papers
    papers = search_papers(query, max_results)
    return {"papers": papers}


@app.post("/api/download_paper")
async def download_paper_api(arxiv_id: str, run_id: str):
    """下载论文API"""
    from .paper_search import confirm_and_download
    result = confirm_and_download(arxiv_id, run_id)
    return result


# ── PDF下载 ──
from fastapi.responses import FileResponse

OUTPUT_DIR = Path(__file__).parent.parent / "output"

@app.get("/api/output/list")
async def list_output_files():
    """列出所有生成的PDF文件"""
    files = []
    if OUTPUT_DIR.exists():
        for f in sorted(OUTPUT_DIR.iterdir(), reverse=True):
            if f.suffix == ".pdf":
                files.append({
                    "name": f.name,
                    "size": f.stat().st_size,
                    "modified": f.stat().st_mtime,
                })
    return {"files": files}

@app.get("/api/output/{filename}")
async def download_output_file(filename: str):
    """下载生成的PDF文件"""
    file_path = OUTPUT_DIR / filename
    if not file_path.exists() or file_path.suffix != ".pdf":
        return JSONResponse(status_code=404, content={"error": "File not found"})
    return FileResponse(
        path=str(file_path),
        filename=filename,
        media_type="application/pdf",
    )


# ── 静态文件服务（在startup中挂载，确保AG-UI端点优先级更高） ──
FRONTEND_DIR = Path(__file__).parent.parent / "frontend" / "dist"


# ── 启动 ──

def main():
    port = int(os.environ.get("PORT", 8765))
    uvicorn.run(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
