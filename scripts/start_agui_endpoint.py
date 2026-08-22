"""Standalone AG-UI endpoint for paper_rewriter agent."""
import sys, os
# 脚本已移入 scripts/，项目根是其上一级
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server.agui_agent import setup_agui_endpoint
from fastapi import FastAPI
import uvicorn

app = FastAPI(title="Paper Rewriter AG-UI Endpoint")
setup_agui_endpoint(app)
print("AG-UI endpoint registered at /api/copilotkit on port 8768")
uvicorn.run(app, host="0.0.0.0", port=8768)
