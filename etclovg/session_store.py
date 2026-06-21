"""Session storage — SQLite持久化

跨设备同步：session列表 + 聊天消息存在服务端。
"""
from __future__ import annotations
import json
import sqlite3
import time
from pathlib import Path
from typing import Optional

_DB_PATH = Path(__file__).parent.parent / "sessions.db"


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = _get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT '',
            created_at REAL NOT NULL,
            last_active REAL NOT NULL,
            message_count INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            tool_name TEXT DEFAULT '',
            timestamp REAL NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, timestamp);
    """)
    conn.close()


# ── Session CRUD ──

def upsert_session(session_id: str, title: str = ""):
    conn = _get_conn()
    now = time.time()
    existing = conn.execute("SELECT id FROM sessions WHERE id = ?", (session_id,)).fetchone()
    if existing:
        conn.execute("UPDATE sessions SET last_active = ?, title = COALESCE(NULLIF(?, ''), title) WHERE id = ?",
                      (now, title, session_id))
    else:
        conn.execute("INSERT INTO sessions (id, title, created_at, last_active) VALUES (?, ?, ?, ?)",
                      (session_id, title or f"会话", now, now))
    conn.commit()
    conn.close()


def list_sessions() -> list[dict]:
    conn = _get_conn()
    rows = conn.execute("""
        SELECT s.id, s.title, s.created_at, s.last_active,
               COALESCE(s.message_count, 0) as message_count
        FROM sessions s ORDER BY s.last_active DESC
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def delete_session(session_id: str):
    conn = _get_conn()
    conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
    conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    conn.commit()
    conn.close()


def update_session_message_count(session_id: str):
    conn = _get_conn()
    count = conn.execute("SELECT COUNT(*) FROM messages WHERE session_id = ?", (session_id,)).fetchone()[0]
    conn.execute("UPDATE sessions SET message_count = ?, last_active = ? WHERE id = ?",
                  (count, time.time(), session_id))
    conn.commit()
    conn.close()


# ── Message CRUD ──

def add_message(session_id: str, msg_id: str, role: str, content: str, tool_name: str = ""):
    conn = _get_conn()
    conn.execute("INSERT OR REPLACE INTO messages (id, session_id, role, content, tool_name, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
                  (msg_id, session_id, role, content, tool_name, time.time()))
    conn.commit()
    conn.close()
    update_session_message_count(session_id)


def get_messages(session_id: str) -> list[dict]:
    conn = _get_conn()
    rows = conn.execute(
        "SELECT id, role, content, tool_name, timestamp FROM messages WHERE session_id = ? ORDER BY timestamp",
        (session_id,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_session_title_from_first_msg(session_id: str) -> str:
    """从第一条用户消息生成session标题"""
    conn = _get_conn()
    row = conn.execute(
        "SELECT content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY timestamp LIMIT 1",
        (session_id,)
    ).fetchone()
    conn.close()
    if row:
        return row["content"][:30]
    return ""


# 初始化
init_db()
