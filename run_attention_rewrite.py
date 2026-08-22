"""自动运行论文重写 Agent — Attention Is All You Need (arXiv:1706.03762)

全自动模式：
1. 让 agent 用 search_paper 搜索论文
2. 用 download_paper 下载并提取文本
3. 生成大纲 → 逐章写作 → 自审
4. generate_pdf 生成最终 PDF

HITL 中断（download_paper / save_outline / write_chapter）全部自动批准。
"""
from __future__ import annotations
import sys
import os
import time
import json
import traceback

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, PROJECT_ROOT)

# Windows UTF-8 兼容
if sys.platform == "win32":
    os.system("chcp 65001 >nul 2>&1")
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from langgraph.types import Command
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage

from agent.graph import build_agent_graph, set_current_run_id, init_run

RUN_ID = os.getenv("RUN_ID", "attention01")
MAX_INTERRUPTS = 80          # 中断自动批准上限（保险丝）
RECURSION_LIMIT = 400        # 图步数上限


def log(msg: str):
    ts = time.strftime("%H:%M:%S")
    line = f"[runner {ts}] {msg}"
    print(line, flush=True)
    try:
        with open(os.path.join(PROJECT_ROOT, "runner.log"), "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def describe_update(node_name: str, payload):
    """打印每个图节点更新的摘要"""
    msgs = payload.get("messages", []) if isinstance(payload, dict) else []
    for m in msgs:
        if isinstance(m, AIMessage) and getattr(m, "tool_calls", None):
            for tc in m.tool_calls:
                args_preview = json.dumps(tc.get("args", {}), ensure_ascii=False)
                log(f"🤖 agent → tool: {tc.get('name')}({args_preview[:160]})")
        elif isinstance(m, AIMessage) and m.content:
            log(f"💬 agent: {str(m.content)[:150]}")
        elif isinstance(m, ToolMessage):
            log(f"🔧 tool[{m.name}] → {str(m.content)[:120]}")


def extract_interrupt(payload):
    """从 __interrupt__ 更新中提取 Interrupt 对元组（可能是 dict 包裹或裸元组）"""
    if isinstance(payload, dict):
        payload = payload.get("__interrupt__")
    if payload and isinstance(payload, (tuple, list)):
        return payload
    return None


def main():
    log(f"=== 启动 run_id={RUN_ID} ===")
    set_current_run_id(RUN_ID)
    init_run(RUN_ID, "", paper_title="Attention Is All You Need")

    graph = build_agent_graph()
    config = {
        "configurable": {"thread_id": RUN_ID},
        "recursion_limit": RECURSION_LIMIT,
    }

    first_message = (
        "请完成论文重写全流程。目标论文：《Attention Is All You Need》（arXiv ID: 1706.03762）。"
        "步骤：1) 用 search_paper 工具搜索 'Attention Is All You Need'；"
        "2) 从结果中找到 arXiv ID 1706.03762 那篇，用 download_paper 下载（source=arxiv）；"
        "3) 浏览原文结构后生成中文通俗重写大纲，用 save_outline 保存；"
        "4) 按大纲逐章写作，每章用 write_chapter 保存，每章至少3000字；"
        "5) 写完所有章节后 list_chapters 确认，再调用 generate_pdf 生成PDF。"
        "目标读者：大一非理工科学生。现在开始。"
    )

    interrupts_handled = 0
    pending = None

    def pump(stream_iter):
        """消费一个stream，返回最后捕获到的中断元组（无则None）"""
        nonlocal pending
        got = None
        for update in stream_iter:
            for node_name, payload in update.items():
                if node_name == "__interrupt__":
                    got = extract_interrupt(payload)
                    if got:
                        for it in got:
                            val = getattr(it, "value", it)
                            log(f"⏸ INTERRUPT: {json.dumps(val, ensure_ascii=False, default=str)[:200]}")
                else:
                    describe_update(node_name, payload)
        return got

    try:
        pending = pump(graph.stream(
            {"messages": [HumanMessage(content=first_message)]},
            config,
            stream_mode="updates",
        ))

        while pending:
            interrupts_handled += 1
            if interrupts_handled > MAX_INTERRUPTS:
                log("❌ 中断次数超上限，停止")
                return 1
            log(f"✅ 自动批准中断 #{interrupts_handled}")
            pending = pump(graph.stream(Command(resume=True), config, stream_mode="updates"))

        log("=== 图执行结束 ===")

    except Exception as e:
        log(f"❌ 执行异常: {type(e).__name__}: {e}")
        log(traceback.format_exc())
        return 1

    # 最终校验
    run_dir = os.path.join(PROJECT_ROOT, "runs", RUN_ID)
    chapters_dir = os.path.join(run_dir, "chapters")
    outline_path = os.path.join(run_dir, "outline.txt")
    original_path = os.path.join(run_dir, "original.txt")
    pdf_path = os.path.join(run_dir, "output.pdf")

    n_original = os.path.getsize(original_path) if os.path.exists(original_path) else 0
    has_outline = os.path.exists(outline_path)
    chapters = sorted(os.listdir(chapters_dir)) if os.path.isdir(chapters_dir) else []
    total_chars = sum(
        os.path.getsize(os.path.join(chapters_dir, c)) for c in chapters
    ) if chapters else 0
    pdf_kb = os.path.getsize(pdf_path) // 1024 if os.path.exists(pdf_path) else 0

    log("=== 结果校验 ===")
    log(f"原文: {n_original} 字符 {'✅' if n_original > 1000 else '❌'}")
    log(f"大纲: {'✅' if has_outline else '❌'}")
    log(f"章节: {len(chapters)} 个, 共 {total_chars} 字符 {'✅' if len(chapters) >= 3 else '⚠️'}")
    log(f"PDF: {pdf_kb} KB {'✅' if pdf_kb > 10 else '❌'}")

    ok = n_original > 1000 and len(chapters) >= 3 and pdf_kb > 10
    log(f"=== 总体: {'🎉 成功' if ok else '⚠️ 未完全成功'} ===")
    return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main())
