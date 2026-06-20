"""Pipeline 配置 — 统一使用小米 MiMo"""
import os

# 完全移除代理，直连所有服务（Clash代理导致langchain_openai超时）
for _k in list(os.environ.keys()):
    if 'proxy' in _k.lower():
        del os.environ[_k]
os.environ['no_proxy'] = '*'

# LLM 配置 — 小米 MiMo
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://token-plan-cn.xiaomimimo.com/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY", "tp-cookzqjavtqj92xgxpvjpd8xnwtt7bdqhzu2eu21aytr0o98")
LLM_MODEL = os.getenv("LLM_MODEL", "mimo-v2.5")

# 质量阈值
PASS_SCORE = float(os.getenv("PASS_SCORE", "8.5"))
MAX_ROUNDS = int(os.getenv("MAX_ROUNDS", "3"))

# 章节批次大小
CHAPTERS_PER_BATCH = int(os.getenv("CHAPTERS_PER_BATCH", "3"))

# PDF 输出目录
OUTPUT_DIR = os.getenv("OUTPUT_DIR", r"C:\Users\Administrator\paper_rewriter_langgraph\output")

# 服务器配置
SERVER_HOST = os.getenv("SERVER_HOST", "0.0.0.0")
SERVER_PORT = int(os.getenv("SERVER_PORT", "8765"))

# 字体路径（Windows SimHei）
FONT_PATH = os.getenv("FONT_PATH", r"C:\Windows\Fonts\simhei.ttf")
