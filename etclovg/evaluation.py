"""Evaluation — 质量评分、趋势追踪

ETCLOVG E: 每次运行记录质量指标，检测回归。
"""
from __future__ import annotations
import json
import math
import time
from dataclasses import dataclass, asdict
from pathlib import Path

_ETCLOVG_DIR = Path(__file__).parent
_QUALITY_LOG = _ETCLOVG_DIR / "quality_log.jsonl"


@dataclass
class QualityMetrics:
    run_id: str
    timestamp: float
    review_score: float
    factcheck_score: float
    combined_score: float
    chapter_count: int
    total_chars: int
    judge_verdict: str = ""
    prompt_version: str = ""


class TrendTracker:
    def __init__(self, window: int = 20):
        self._window = window
        self._metrics: list[QualityMetrics] = []
        self._load()

    def _load(self):
        if _QUALITY_LOG.exists():
            for line in _QUALITY_LOG.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    d = json.loads(line)
                    self._metrics.append(QualityMetrics(**d))
                except (json.JSONDecodeError, TypeError):
                    pass

    def record(self, m: QualityMetrics):
        self._metrics.append(m)
        _ETCLOVG_DIR.mkdir(exist_ok=True)
        with open(_QUALITY_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(asdict(m), ensure_ascii=False) + "\n")

    def detect_regression(self) -> dict:
        """检测质量回归：最近分数低于均值-1.5*标准差"""
        scores = [m.combined_score for m in self._metrics[-self._window:]]
        if len(scores) < 3:
            return {"regression": False, "reason": "数据不足"}
        mean = sum(scores) / len(scores)
        std = math.sqrt(sum((s - mean) ** 2 for s in scores) / len(scores))
        latest = scores[-1]
        threshold = mean - 1.5 * std
        return {
            "regression": latest < threshold,
            "latest_score": latest,
            "mean": round(mean, 2),
            "std": round(std, 2),
            "threshold": round(threshold, 2),
        }

    def trend_data(self, last_n: int = 20) -> list[dict]:
        recent = self._metrics[-last_n:]
        return [
            {
                "run_id": m.run_id,
                "timestamp": m.timestamp,
                "combined_score": m.combined_score,
                "review_score": m.review_score,
                "factcheck_score": m.factcheck_score,
                "chapter_count": m.chapter_count,
                "total_chars": m.total_chars,
            }
            for m in recent
        ]

    def status(self) -> dict:
        regression = self.detect_regression()
        scores = [m.combined_score for m in self._metrics[-self._window:]]
        return {
            "total_runs": len(self._metrics),
            "recent_mean": round(sum(scores) / max(len(scores), 1), 2),
            "regression": regression,
            "trend": self.trend_data(10),
        }


# ── 全局单例 ──
tracker = TrendTracker()


def record_metrics(m: QualityMetrics):
    tracker.record(m)


def get_evaluation_status() -> dict:
    return tracker.status()
