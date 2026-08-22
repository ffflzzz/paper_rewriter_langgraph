# 📄 Paper Rewriter LangGraph

基于 **LangGraph** 的论文重写 Agent 系统：自动搜索并下载学术论文，将其重写为通俗易懂的中文科普文章，并生成排版好的 PDF。

> 已端到端验证：输入 *Attention Is All You Need*（arXiv: 1706.03762）→ 自动搜索、下载、提取原文（约 4 万字符）→ 生成大纲 → 逐章写作并审查 → 输出 24 页中文 PDF（`runs/attention01/output.pdf`）。

## ✨ 核心特性

- 🔍 **多源论文检索** — arXiv / Semantic Scholar / CrossRef / PubMed 官方 API，自动下载 PDF 并提取文本
- 🤖 **ReAct Agent** — LangGraph `ToolNode` + `bind_tools`，模型自主决策调用工具完成全流程
- 👁️ **HITL 人机协同** — 关键操作（下载论文 / 保存大纲 / 写入章节）通过 `interrupt()` 暂停等待确认；也支持全自动模式（见 `run_attention_rewrite.py`）
- 🔁 **写作-审查闭环** — 每章写完由独立 session 的审稿人节点评分（准确性 / 通俗性 / 结构 / 完整性 / 字数），未通过则带着具体问题清单重写；事实疑点会用 `search_original` 回查原文核实
- 📊 **实时 Dashboard** — FastAPI + SSE 推送工具调用、LLM token 流、进度状态；React 前端可视化
- 📈 **治理与度量** — token 用量记录、prompt 版本管理、SQLite 会话存储（`etclovg/`）

## 🏗️ 架构

```
┌─────────────────────────────────────────────────────┐
│  入口层                                              │
│  server/agent_app.py   FastAPI Dashboard (:8765)    │
│  agent/server_agui.py  AG-UI 协议服务   (:8765)      │
│  terminal_ui.py        终端全屏 TUI                  │
│  run_attention_rewrite.py  全自动命令行运行器          │
├─────────────────────────────────────────────────────┤
│  Agent 层 (agent/graph.py)                          │
│                                                     │
│   START → agent ⇄ tools → review → agent → … → END  │
│              ↑                        │             │
│              └── 审查未通过，带问题清单重写 ─┘            │
├─────────────────────────────────────────────────────┤
│  工具集                                              │
│  search_paper        多源学术搜索                     │
│  download_paper      下载PDF+提取文本（HITL）          │
│  search_original     原文关键词检索                    │
│  read_original_segment 按百分比浏览原文               │
│  save_outline        保存章节大纲（HITL）              │
│  write_chapter       写入单章（HITL）                 │
│  read_chapter/list_chapters/self_review_chapter     │
│  generate_pdf        合并生成PDF                      │
├─────────────────────────────────────────────────────┤
│  Pipeline 层 (pipeline/) — 多角色流水线（备选架构）      │
│  outline_generator → writer → reviewer              │
│  → fact_checker → judge →(循环)→ pdf_generator      │
└─────────────────────────────────────────────────────┘
```

每次运行的产物落盘在 `runs/<run_id>/`：

```
runs/attention01/
├── original.txt      # 提取的论文原文
├── outline.txt       # 章节大纲
├── chapters/         # Ch1.txt … ChN.txt 各章正文
├── progress.json     # 写作进度
├── <arxiv_id>.pdf    # 下载的原始论文
└── output.pdf        # 最终生成的中文重写 PDF
```

## 🚀 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt pymupdf
```

### 2. 配置 LLM（任选其一）

默认使用 Agnes AI（OpenAI 兼容协议），通过环境变量覆盖：

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `LLM_BASE_URL` | `https://apihub.agnes-ai.com/v1` | OpenAI 兼容 API 地址 |
| `LLM_API_KEY` | — | API Key |
| `LLM_MODEL` | `agnes-2.5-flash` | 模型名 |
| `LLM_PROVIDER` | `agnes` | 设为 `mimo` 切换小米 MiMo |
| `AGENT_MAX_TOKENS` | `16384` | Agent 单次输出上限 |

### 3. 运行

**方式 A：全自动重写一篇论文**（推荐先试这个）

```bash
python run_attention_rewrite.py
# HITL 中断全部自动批准，实时打印进度，结束后自动校验产物
```

**方式 B：Web Dashboard**

```bash
python run.py                # http://localhost:8765
# 页面上传 PDF/TXT 或粘贴文本 → 启动重写 → 实时查看 Agent 动作
```

**方式 C：终端 TUI**

```bash
python terminal_ui.py --run-id my_run
```

**方式 D：AG-UI 协议服务**（可对接 CopilotKit 前端）

```bash
python -m agent.server_agui  # 默认 :8765，PORT 可覆盖
```

## 🔬 工作流程

1. **找论文** — Agent 调用 `search_paper` 在多个学术源检索，选定目标后 `download_paper` 下载 PDF 并提取全文
2. **读原文** — 用 `read_original_segment` 分段浏览、`search_original` 定位关键概念
3. **出大纲** — 按"每 1–2 万字原文 ≈ 1 章"动态规划章节，`save_outline` 保存
4. **逐章写作** — 每章 ≥3000 字，"微分-积分"方法：拆解概念 → 生活化比喻 → 连贯叙事；术语首现标注英文
5. **独立审查** — 每章由独立 session 的审稿人按五项标准打分；未通过则附问题清单重写（3 次上限保险丝防止死循环）；数据类陈述回查原文核实
6. **生成 PDF** — 全部完成后 `generate_pdf` 合并为带中文字体的 PDF

## 📡 主要 API（Dashboard 模式）

| 端点 | 说明 |
|------|------|
| `POST /api/run` | 启动一次重写 |
| `GET /api/status` | 当前运行状态 |
| `GET /api/events` | SSE 实时事件流 |
| `POST /api/upload` | 上传 PDF/TXT 提取文本 |
| `GET /api/runs` | 历史 run 列表 |
| `GET /api/graph` | 流水线图结构 |

## 🛠️ 技术栈

LangGraph · LangChain · OpenAI 兼容 LLM · FastAPI · SSE · React/Vite · fpdf2 · PyMuPDF
