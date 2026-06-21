"""Versioning — Prompt版本管理

ETCLOVG V: 跟踪system prompt变更，每次运行记录使用的版本。
"""
from __future__ import annotations
import hashlib
import json
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

_ETCLOVG_DIR = Path(__file__).parent
_VERSIONS_FILE = _ETCLOVG_DIR / "prompt_versions.json"


@dataclass
class PromptVersion:
    content: str
    hash: str
    timestamp: float
    notes: str = ""


class VersionRegistry:
    def __init__(self):
        self._versions: list[PromptVersion] = []
        self._load()

    def _load(self):
        if _VERSIONS_FILE.exists():
            try:
                data = json.loads(_VERSIONS_FILE.read_text(encoding="utf-8"))
                self._versions = [PromptVersion(**v) for v in data]
            except (json.JSONDecodeError, TypeError):
                self._versions = []

    def _save(self):
        _ETCLOVG_DIR.mkdir(exist_ok=True)
        _VERSIONS_FILE.write_text(
            json.dumps([asdict(v) for v in self._versions], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    @staticmethod
    def _hash(content: str) -> str:
        return hashlib.sha256(content.encode()).hexdigest()[:12]

    def register(self, content: str, notes: str = "") -> Optional[PromptVersion]:
        """注册prompt，如果内容变了返回新版本，否则返回None"""
        h = self._hash(content)
        if self._versions and self._versions[-1].hash == h:
            return None
        version = PromptVersion(
            content=content, hash=h, timestamp=time.time(), notes=notes,
        )
        self._versions.append(version)
        self._save()
        return version

    def current(self) -> Optional[PromptVersion]:
        return self._versions[-1] if self._versions else None

    def history(self) -> list[dict]:
        return [
            {"hash": v.hash, "timestamp": v.timestamp, "notes": v.notes}
            for v in self._versions
        ]

    def info(self) -> dict:
        cur = self.current()
        return {
            "current_version": cur.hash if cur else None,
            "total_versions": len(self._versions),
            "history": self.history()[-10:],
        }


# ── 全局单例 ──
registry = VersionRegistry()


def register_prompt(content: str, notes: str = "") -> Optional[PromptVersion]:
    return registry.register(content, notes)


def get_version_info() -> dict:
    return registry.info()
