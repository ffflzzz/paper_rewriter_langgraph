"""论文重写 Agent 系统 — 入口（Agent架构版）"""
import sys
import os

# Windows UTF-8 兼容
if sys.platform == "win32":
    os.system("chcp 65001 >nul 2>&1")
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# 确保项目根目录在 path 中
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from server.agent_app import app
from pipeline.config import SERVER_HOST, SERVER_PORT

if __name__ == "__main__":
    import uvicorn
    print(f"🚀 论文重写 Agent Dashboard (LangGraph ReAct)")
    print(f"   地址: http://localhost:{SERVER_PORT}")
    print(f"   API:  http://localhost:{SERVER_PORT}/api/status")
    uvicorn.run(app, host=SERVER_HOST, port=SERVER_PORT)
