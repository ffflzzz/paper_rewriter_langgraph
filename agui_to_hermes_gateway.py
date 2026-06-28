#!/usr/bin/env python3
"""
AG-UI to Hermes Protocol Gateway (WebSocket)

Translates AG-UI SSE events from LangGraph backend to Hermes JSON-RPC 2.0 format
over WebSocket. Allows using Hermes TUI as frontend for any AG-UI compatible
LangGraph agent.

Usage:
    # Start gateway
    python3 agui_to_hermes_gateway.py --port 9999 --url http://localhost:8765

    # Connect Hermes TUI
    HERMES_TUI_GATEWAY_URL=ws://localhost:9999 hermes --tui

Architecture:
    LangGraph Agent ←AG-UI SSE→ This Gateway ←JSON-RPC WebSocket→ Hermes TUI
"""

import argparse
import asyncio
import json
import sys
import time
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler

try:
    import websockets
except ImportError:
    print("Installing websockets...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "websockets"])
    import websockets

try:
    import requests
except ImportError:
    print("Installing requests...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests"])
    import requests

# ── Hermes Protocol Helpers ────────────────────────────────────────
def hermes_event(event_type: str, session_id: str, payload: dict = None) -> str:
    """Create a Hermes JSON-RPC 2.0 event frame."""
    params = {"type": event_type, "session_id": session_id}
    if payload is not None:
        params["payload"] = payload
    return json.dumps({"jsonrpc": "2.0", "method": "event", "params": params})

def hermes_response(rid, result) -> str:
    """Create a JSON-RPC response frame."""
    return json.dumps({"jsonrpc": "2.0", "id": rid, "result": result})

def hermes_error(rid, code, message) -> str:
    """Create a JSON-RPC error frame."""
    return json.dumps({"jsonrpc": "2.0", "id": rid, "error": {"code": code, "message": message}})

# ── AG-UI Client ───────────────────────────────────────────────────
class AguiClient:
    """Connects to AG-UI backend and translates events."""

    def __init__(self, base_url: str, session_id: str):
        self.base_url = base_url.rstrip('/')
        self.session_id = session_id
        self.ws = None

    async def send_message(self, text: str, rid=None):
        """Send a message to AG-UI backend and stream events to WebSocket."""
        try:
            payload = {
                "threadId": self.session_id,
                "runId": f"run-{int(time.time())}",
                "messages": [{"id": f"m-{int(time.time())}", "role": "user", "content": text}],
                "tools": [],
                "context": [],
                "forwardedProps": {},
            }

            await self.ws.send(hermes_event("message.start", self.session_id))

            # Send to AG-UI backend (blocking, run in thread)
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(None, lambda: requests.post(
                f"{self.base_url}/api/copilotkit",
                json=payload,
                stream=True,
                headers={"Content-Type": "application/json"},
                timeout=300,
            ))

            if response.status_code != 200:
                await self.ws.send(hermes_event("error", self.session_id,
                    {"message": f"AG-UI {response.status_code}: {response.text[:200]}"}))
                await self.ws.send(hermes_event("message.complete", self.session_id, {"text": ""}))
                if rid:
                    await self.ws.send(hermes_response(rid, {"ok": True}))
                return

            current_text = ""
            for line in response.iter_lines(decode_unicode=True):
                if not line or not line.startswith("data: "):
                    continue

                data_str = line[6:]
                if data_str.strip() == "[DONE]":
                    break

                try:
                    event = json.loads(data_str)
                except json.JSONDecodeError:
                    continue

                event_type = event.get("type", "")

                if event_type == "TEXT_MESSAGE_CONTENT":
                    delta = event.get("delta", "")
                    if delta:
                        current_text += delta
                        await self.ws.send(hermes_event("message.delta", self.session_id, {"text": delta}))

                elif event_type == "TOOL_CALL_START":
                    tool_name = event.get("toolCallName", event.get("name", "?"))
                    tool_labels = {
                        "search_paper": "🔍 搜索论文",
                        "download_paper": "📥 下载论文",
                        "read_original_segment": "📖 读取原文",
                        "write_chapter": "✍️ 写章节",
                        "save_outline": "📝 保存大纲",
                        "self_review_chapter": "🔍 自审章节",
                        "generate_pdf": "📄 生成PDF",
                        "search_original": "🔍 搜索原文",
                    }
                    label = tool_labels.get(tool_name, f"🔧 {tool_name}")
                    await self.ws.send(hermes_event("tool.start", self.session_id, {
                        "name": tool_name,
                        "args": event.get("args", ""),
                    }))
                    await self.ws.send(hermes_event("status.update", self.session_id,
                        {"kind": "process", "text": f"{label}..."}))

                elif event_type == "TOOL_CALL_END":
                    await self.ws.send(hermes_event("tool.complete", self.session_id, {
                        "name": event.get("toolCallName", ""),
                        "result": event.get("content", ""),
                    }))

                elif event_type == "TOOL_CALL_RESULT":
                    await self.ws.send(hermes_event("tool.complete", self.session_id, {
                        "name": event.get("toolCallName", ""),
                        "result": event.get("content", ""),
                    }))

                elif event_type == "STEP_STARTED":
                    step_name = event.get("stepName", "unknown")
                    step_labels = {
                        "agent": "🧠 agent节点 — LLM推理中",
                        "tools": "🔧 tools节点 — 执行工具",
                        "review": "🔍 review节点 — 独立审查",
                    }
                    label = step_labels.get(step_name, f"⚙️ {step_name}")
                    await self.ws.send(hermes_event("status.update", self.session_id,
                        {"kind": "process", "text": label}))

                elif event_type == "RUN_STARTED":
                    await self.ws.send(hermes_event("status.update", self.session_id,
                        {"kind": "thinking", "text": "thinking..."}))

                elif event_type == "RUN_FINISHED":
                    await self.ws.send(hermes_event("status.update", self.session_id,
                        {"kind": "idle", "text": "done"}))

                elif event_type == "RUN_ERROR":
                    await self.ws.send(hermes_event("error", self.session_id,
                        {"message": event.get("error", "Unknown error")}))

            await self.ws.send(hermes_event("message.complete", self.session_id, {"text": current_text}))

        except Exception as e:
            await self.ws.send(hermes_event("error", self.session_id, {"message": str(e)}))
            await self.ws.send(hermes_event("message.complete", self.session_id, {"text": ""}))

        if rid:
            await self.ws.send(hermes_response(rid, {"ok": True}))

# ── WebSocket Handler ──────────────────────────────────────────────
async def handle_client(websocket, agui_url: str):
    """Handle a single WebSocket client connection."""
    session_id = f"agui-{int(time.time())}"
    client = AguiClient(agui_url, session_id)
    client.ws = websocket

    # Send gateway.ready
    await websocket.send(hermes_event("gateway.ready", session_id, {
        "version": "1.0.0",
        "backend": "agui-langgraph",
    }))

    try:
        async for message in websocket:
            try:
                req = json.loads(message)
            except json.JSONDecodeError:
                continue

            method = req.get("method", "")
            rid = req.get("id")
            params = req.get("params", {})

            if method == "session.create":
                await websocket.send(hermes_response(rid, {
                    "session_id": session_id,
                    "status": "ok",
                }))

            elif method == "session.resume":
                text = params.get("text", params.get("content", ""))
                if text:
                    asyncio.create_task(client.send_message(text, rid))
                    await websocket.send(hermes_response(rid, {"ok": True, "status": "processing"}))
                else:
                    await websocket.send(hermes_response(rid, {"ok": True}))

            elif method == "prompt.submit":
                # Hermes TUI sends prompt.submit with session_id and text
                text = params.get("text", params.get("content", ""))
                session_id = params.get("session_id", "")
                if text:
                    asyncio.create_task(client.send_message(text, rid))
                    # Send immediate ack so TUI doesn't hang
                    await websocket.send(hermes_response(rid, {"ok": True, "status": "processing"}))
                else:
                    await websocket.send(hermes_response(rid, {"ok": True}))

            elif method == "session.interrupt":
                await websocket.send(hermes_response(rid, {"ok": True}))

            elif method == "session.status":
                await websocket.send(hermes_response(rid, {
                    "session_id": session_id,
                    "status": "idle",
                }))

            elif method == "session.history":
                await websocket.send(hermes_response(rid, {"messages": []}))

            elif method == "session.close":
                await websocket.send(hermes_response(rid, {"ok": True}))
                break

            elif method == "ping":
                await websocket.send(hermes_response(rid, {"pong": True}))

            else:
                await websocket.send(hermes_response(rid, {}))

    except websockets.exceptions.ConnectionClosed:
        pass

# ── Entry Point ────────────────────────────────────────────────────
async def main(port: int, agui_url: str):
    """Start the WebSocket gateway."""
    print(f"AG-UI → Hermes Gateway listening on ws://localhost:{port}")
    print(f"AG-UI backend: {agui_url}")
    print(f"Connect with: HERMES_TUI_GATEWAY_URL=ws://localhost:{port} hermes --tui")

    async with websockets.serve(lambda ws: handle_client(ws, agui_url), "localhost", port):
        await asyncio.Future()  # Run forever

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AG-UI to Hermes Protocol Gateway")
    parser.add_argument("--port", type=int, default=9999, help="WebSocket port")
    parser.add_argument("--url", default="http://localhost:8765", help="AG-UI backend URL")
    args = parser.parse_args()

    asyncio.run(main(args.port, args.url))
