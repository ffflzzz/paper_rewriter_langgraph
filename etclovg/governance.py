"""Governance — Token计数、成本追踪、限流

ETCLOVG G: 跟踪每次LLM调用的token使用量和成本，防止超支。
"""
from __future__ import annotations
import json
import time
import threading
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

_ETCLOVG_DIR = Path(__file__).parent
_USAGE_LOG = _ETCLOVG_DIR / "usage_log.jsonl"

# MiMo v2.5 Pro 定价（每1K tokens，单位：元）
COST_PER_1K_INPUT = 0.001
COST_PER_1K_OUTPUT = 0.002


@dataclass
class TokenUsage:
    """一次LLM调用的token使用量"""
    timestamp: float
    model: str
    input_tokens: int
    output_tokens: int
    total_tokens: int
    cost: float
    run_id: str = ""
    node: str = ""
    prompt_version: str = ""

    @property
    def cost_yuan(self) -> float:
        return self.cost


class TokenUsageTracker:
    """累计token使用量追踪"""

    def __init__(self):
        self._lock = threading.Lock()
        self._session_input = 0
        self._session_output = 0
        self._session_total = 0
        self._session_cost = 0.0
        self._request_count = 0
        self._history: list[TokenUsage] = []

    def record(self, usage: TokenUsage):
        with self._lock:
            self._session_input += usage.input_tokens
            self._session_output += usage.output_tokens
            self._session_total += usage.total_tokens
            self._session_cost += usage.cost
            self._request_count += 1
            self._history.append(usage)

        # 写日志
        try:
            with open(_USAGE_LOG, "a", encoding="utf-8") as f:
                f.write(json.dumps(asdict(usage), ensure_ascii=False) + "\n")
        except OSError:
            pass

    @property
    def summary(self) -> dict:
        with self._lock:
            return {
                "session_input_tokens": self._session_input,
                "session_output_tokens": self._session_output,
                "session_total_tokens": self._session_total,
                "session_cost_yuan": round(self._session_cost, 6),
                "request_count": self._request_count,
                "avg_input_tokens": self._session_input // max(self._request_count, 1),
                "avg_output_tokens": self._session_output // max(self._request_count, 1),
            }


class RateLimiter:
    """令牌桶限流器"""

    def __init__(self, max_requests: int = 10, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window = window_seconds
        self._timestamps: list[float] = []
        self._lock = threading.Lock()

    def acquire(self) -> tuple[bool, Optional[float]]:
        """尝试获取令牌。返回 (allowed, retry_after_seconds)"""
        now = time.time()
        with self._lock:
            # 清理过期时间戳
            self._timestamps = [t for t in self._timestamps if now - t < self.window]

            if len(self._timestamps) >= self.max_requests:
                oldest = self._timestamps[0]
                retry_after = self.window - (now - oldest)
                return False, retry_after

            self._timestamps.append(now)
            return True, None

    @property
    def status(self) -> dict:
        now = time.time()
        with self._lock:
            active = len([t for t in self._timestamps if now - t < self.window])
            return {
                "max_requests": self.max_requests,
                "window_seconds": self.window,
                "current_count": active,
                "remaining": self.max_requests - active,
            }


# ── 全局单例 ──
tracker = TokenUsageTracker()
rate_limiter = RateLimiter(max_requests=20, window_seconds=60)


def calculate_cost(input_tokens: int, output_tokens: int) -> float:
    """计算一次调用的成本（元）"""
    return (input_tokens * COST_PER_1K_INPUT + output_tokens * COST_PER_1K_OUTPUT) / 1000


def record_usage(
    model: str,
    input_tokens: int,
    output_tokens: int,
    run_id: str = "",
    node: str = "",
    prompt_version: str = "",
) -> TokenUsage:
    """记录一次LLM调用的token使用量"""
    cost = calculate_cost(input_tokens, output_tokens)
    usage = TokenUsage(
        timestamp=time.time(),
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
        cost=cost,
        run_id=run_id,
        node=node,
        prompt_version=prompt_version,
    )
    tracker.record(usage)
    return usage


def extract_usage_from_response(response) -> tuple[int, int]:
    """从LangChain response中提取token使用量"""
    usage = getattr(response, "usage_metadata", None) or {}
    input_tokens = usage.get("input_tokens", 0) or 0
    output_tokens = usage.get("output_tokens", 0) or 0
    return input_tokens, output_tokens


def get_governance_status() -> dict:
    """获取Governance状态（供API端点使用）"""
    return {
        "token_usage": tracker.summary,
        "rate_limiter": rate_limiter.status,
        "pricing": {
            "input_per_1k": COST_PER_1K_INPUT,
            "output_per_1k": COST_PER_1K_OUTPUT,
            "currency": "CNY",
        },
    }
