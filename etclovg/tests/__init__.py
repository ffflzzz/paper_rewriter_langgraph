"""Tests — 关键路径单元测试"""
import pytest
import json
import time
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock


# ── Governance Tests ──

class TestGovernance:
    def test_calculate_cost(self):
        from etclovg.governance import calculate_cost
        cost = calculate_cost(1000, 1000)
        assert cost == pytest.approx(0.003, abs=0.0001)

    def test_calculate_cost_zero(self):
        from etclovg.governance import calculate_cost
        assert calculate_cost(0, 0) == 0.0

    def test_rate_limiter_allows(self):
        from etclovg.governance import RateLimiter
        limiter = RateLimiter(max_requests=3, window_seconds=60)
        allowed, _ = limiter.acquire()
        assert allowed is True

    def test_rate_limiter_blocks(self):
        from etclovg.governance import RateLimiter
        limiter = RateLimiter(max_requests=2, window_seconds=60)
        limiter.acquire()
        limiter.acquire()
        allowed, retry = limiter.acquire()
        assert allowed is False
        assert retry is not None and retry > 0

    def test_tracker_summary(self):
        from etclovg.governance import TokenUsageTracker, TokenUsage
        t = TokenUsageTracker()
        t.record(TokenUsage(
            timestamp=time.time(), model="test",
            input_tokens=100, output_tokens=50, total_tokens=150,
            cost=0.0002,
        ))
        s = t.summary
        assert s["session_input_tokens"] == 100
        assert s["session_output_tokens"] == 50
        assert s["request_count"] == 1

    def test_extract_usage(self):
        from etclovg.governance import extract_usage_from_response
        mock = MagicMock()
        mock.usage_metadata = {"input_tokens": 200, "output_tokens": 100}
        inp, out = extract_usage_from_response(mock)
        assert inp == 200
        assert out == 100


# ── Versioning Tests ──

class TestVersioning:
    def test_register_new(self, tmp_path):
        from etclovg.versioning import VersionRegistry
        with patch("etclovg.versioning._VERSIONS_FILE", tmp_path / "v.json"):
            reg = VersionRegistry()
            v = reg.register("hello prompt", notes="v1")
            assert v is not None
            assert v.hash == reg._hash("hello prompt")

    def test_register_duplicate(self, tmp_path):
        from etclovg.versioning import VersionRegistry
        with patch("etclovg.versioning._VERSIONS_FILE", tmp_path / "v.json"):
            reg = VersionRegistry()
            reg.register("hello")
            v2 = reg.register("hello")
            assert v2 is None

    def test_register_change(self, tmp_path):
        from etclovg.versioning import VersionRegistry
        with patch("etclovg.versioning._VERSIONS_FILE", tmp_path / "v.json"):
            reg = VersionRegistry()
            reg.register("v1")
            v2 = reg.register("v2")
            assert v2 is not None
            assert reg.current().hash == v2.hash

    def test_version_info(self, tmp_path):
        from etclovg.versioning import VersionRegistry
        with patch("etclovg.versioning._VERSIONS_FILE", tmp_path / "v.json"):
            reg = VersionRegistry()
            reg.register("a")
            reg.register("b")
            info = reg.info()
            assert info["total_versions"] == 2


# ── Evaluation Tests ──

class TestEvaluation:
    def test_detect_regression_no_data(self, tmp_path):
        from etclovg.evaluation import TrendTracker
        with patch("etclovg.evaluation._QUALITY_LOG", tmp_path / "q.jsonl"):
            t = TrendTracker()
            r = t.detect_regression()
            assert r["regression"] is False

    def test_detect_regression_normal(self, tmp_path):
        from etclovg.evaluation import TrendTracker, QualityMetrics
        with patch("etclovg.evaluation._QUALITY_LOG", tmp_path / "q.jsonl"):
            t = TrendTracker()
            for i in range(10):
                t.record(QualityMetrics(
                    run_id=f"r{i}", timestamp=time.time(),
                    review_score=8.0, factcheck_score=8.0,
                    combined_score=8.0, chapter_count=5, total_chars=10000,
                ))
            r = t.detect_regression()
            assert r["regression"] is False

    def test_detect_regression_drop(self, tmp_path):
        from etclovg.evaluation import TrendTracker, QualityMetrics
        with patch("etclovg.evaluation._QUALITY_LOG", tmp_path / "q.jsonl"):
            t = TrendTracker()
            for i in range(10):
                t.record(QualityMetrics(
                    run_id=f"r{i}", timestamp=time.time(),
                    review_score=8.0, factcheck_score=8.0,
                    combined_score=8.0, chapter_count=5, total_chars=10000,
                ))
            # 突然下降
            t.record(QualityMetrics(
                run_id="bad", timestamp=time.time(),
                review_score=3.0, factcheck_score=3.0,
                combined_score=3.0, chapter_count=2, total_chars=3000,
            ))
            r = t.detect_regression()
            assert r["regression"] is True

    def test_trend_data(self, tmp_path):
        from etclovg.evaluation import TrendTracker, QualityMetrics
        with patch("etclovg.evaluation._QUALITY_LOG", tmp_path / "q.jsonl"):
            t = TrendTracker()
            t.record(QualityMetrics(
                run_id="r1", timestamp=time.time(),
                review_score=7.5, factcheck_score=8.0,
                combined_score=7.7, chapter_count=5, total_chars=12000,
            ))
            data = t.trend_data()
            assert len(data) == 1
            assert data[0]["combined_score"] == 7.7


# ── Context Tests ──

class TestContext:
    def test_chunk_text(self):
        from pipeline.context import chunk_text
        text = "段落一\n\n段落二\n\n段落三"
        chunks = chunk_text(text, min_chunk_chars=2)
        assert len(chunks) == 3

    def test_extract_keywords(self):
        from pipeline.context import extract_keywords
        text = "深度学习神经网络自然语言处理机器学习"
        kws = extract_keywords(text, top_n=5)
        assert len(kws) > 0
        assert all(isinstance(k, str) for k in kws)

    def test_chunk_empty(self):
        from pipeline.context import chunk_text
        assert chunk_text("") == []


# ── Events Tests ──

class TestEvents:
    def test_emitter_subscribe(self):
        from pipeline.events import EventEmitter
        e = EventEmitter()
        q = e.subscribe()
        assert q in e._subscribers

    def test_emitter_unsubscribe(self):
        from pipeline.events import EventEmitter
        e = EventEmitter()
        q = e.subscribe()
        e.unsubscribe(q)
        assert q not in e._subscribers
