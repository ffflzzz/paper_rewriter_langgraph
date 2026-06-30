"""Pipeline 配置 - 统一使用 Agnes AI"""
import os

# 完全移除代理，直连所有服务（Clash代理导致langchain_openai超时）
for _k in list(os.environ.keys()):
    if 'proxy' in _k.lower():
        del os.environ[_k]
os.environ['no_proxy'] = '*'

# LLM 配置 - Agnes AI
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://apihub.agnes-ai.com/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY", "cpk-8FX8tQvmzWKq5oHyf1C7h0ugkYA7uPuSPfbi7SQ95foE67Ds")
LLM_MODEL = os.getenv("LLM_MODEL", "agnes-2.0-flash")

# 质量阈值
PASS_SCORE = float(os.getenv("PASS_SCORE", "8.5"))
MAX_ROUNDS = int(os.getenv("MAX_ROUNDS", "3"))

# 章节批量大小
CHAPTERS_PER_BATCH = int(os.getenv("CHAPTERS_PER_BATCH", "3"))

# PDF 输出目录
OUTPUT_DIR = os.getenv("OUTPUT_DIR", r"C:\Users\Administrator\paper_rewriter_langgraph\output")

# 服务器配置
SERVER_HOST = os.getenv("SERVER_HOST", "0.0.0.0")
SERVER_PORT = int(os.getenv("SERVER_PORT", "8765"))

# 字体路径（Windows SimHei）
FONT_PATH = os.getenv("FONT_PATH", r"C:\Windows\Fonts\simhei.ttf")
