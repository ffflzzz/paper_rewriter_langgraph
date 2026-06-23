#!/usr/bin/env python3
"""Terminal UI for Paper Rewriter LangGraph Agent — LOCAL mode.

Matrix/hacker-style TUI with raw ANSI escape codes.
Runs the agent graph in-process. No remote server needed.
Streams events directly from LangGraph's astream_events API.

Usage:
    python3 terminal_ui.py [--run-id RUN_ID]
"""

# ═══════════════════════════════════════════════════════════════
# CRITICAL: Set no_proxy BEFORE any langchain/openai imports
# Otherwise import takes 20s going through Clash proxy to
# xiaomimimo.com during package discovery.
# ═══════════════════════════════════════════════════════════════
import os
import sys

_PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

# Remove all proxy env vars and set no_proxy wildcard
for _k in list(os.environ.keys()):
    if "proxy" in _k.lower():
        del os.environ[_k]
os.environ["no_proxy"] = "*"

# ── Now safe to import everything ──
import argparse
import asyncio
import json
import readline  # Enable proper backspace/editing in input()
import signal
import shutil
import time
import traceback
from typing import Optional

from langchain_core.messages import (
    HumanMessage,
    AIMessage,
    SystemMessage,
    ToolMessage,
)
from langgraph.types import Command

# ═══════════════════════════════════════════════════════════════
# ANSI Color Constants — Matrix Theme
# ═══════════════════════════════════════════════════════════════
RESET    = "\033[0m"
BOLD     = "\033[1m"
DIM      = "\033[2m"
GREEN    = "\033[32m"       # standard green
BGREEN   = "\033[92m"       # bright green
DGREEN   = "\033[2;32m"     # dim green
DARKGRN  = "\033[38;5;22m"  # dark green (#005500)
CYAN     = "\033[36m"
YELLOW   = "\033[33m"
RED      = "\033[31m"
BRED     = "\033[1;31m"
WHITE    = "\033[37m"
BWHITE   = "\033[1;37m"

# Box-drawing chars (thin)
BOX_H  = "─"
BOX_V  = "│"
BOX_TL = "┌"
BOX_TR = "┐"
BOX_BL = "└"
BOX_BR = "┘"

# ═══════════════════════════════════════════════════════════════
# Terminal Helpers
# ═══════════════════════════════════════════════════════════════
def _term_width() -> int:
    """Get terminal width, default 80."""
    try:
        return shutil.get_terminal_size((80, 24)).columns
    except Exception:
        return 80


def _hr(char: str = BOX_H, width: int = 0) -> str:
    """Horizontal rule."""
    w = width or _term_width()
    return f"{DGREEN}{char * w}{RESET}"


def _clear_screen():
    """Clear terminal and move cursor to top-left."""
    sys.stdout.write("\033[2J\033[H")
    sys.stdout.flush()


def _print(text: str = "", end: str = "\n"):
    """Print with flush."""
    sys.stdout.write(text + end)
    sys.stdout.flush()


def _stream_char(text: str, delay: float = 0.012):
    """Stream text character by character in green."""
    for ch in text:
        sys.stdout.write(f"{GREEN}{ch}{RESET}")
        sys.stdout.flush()
        if delay > 0:
            time.sleep(delay)


# ═══════════════════════════════════════════════════════════════
# ASCII Art Banner
# ═══════════════════════════════════════════════════════════════
BANNER_ART = r"""
{bold}{green}
 ____            _             ____                            _
|  _ \ ___  _ _| |_ ___ _ __ |  _ \ _____      _____ _ __ ___(_) ___  _ __
| |_) / _ \| '_| __/ _ \ '__|| |_) / _ \ \ /\ / / _ \ '__/ __| |/ _ \| '_ \
|  __/ (_) | | | ||  __/ |   |  _ <  __/\ V  V /  __/ | | (__| | (_) | | | |
|_|   \___/|_|  \__\___|_|   |_| \_\___| \_/\_/ \___|_|  \___|_|\___/|_| |_|
{reset}{dim}{green}
  ═══════════════════════════════════════════════════════════════
  :: LangGraph Agent :: Local Mode :: Matrix Terminal ::{reset}
""".format(bold=BOLD, green=BGREEN, dim=DIM, reset=RESET)


# ═══════════════════════════════════════════════════════════════
# Session State
# ═══════════════════════════════════════════════════════════════
class Session:
    """Manages the agent conversation state."""

    def __init__(self, run_id: str = ""):
        self.run_id = run_id or f"local-{int(time.time()) % 100000:05d}"
        self.messages: list = []
        self.graph = None
        self.tool_call_count = 0
        self.turn_count = 0
        self.started_at = time.time()
        self._build_graph()

    def _build_graph(self):
        """Build the LangGraph agent graph locally."""
        from agent.graph import build_agent_graph, set_current_run_id
        set_current_run_id(self.run_id)
        self.graph = build_agent_graph()
        _print(f"{DGREEN}  Agent graph built locally.{RESET}")

    def reset(self, new_run_id: str = ""):
        """Reset session for a new conversation."""
        self.run_id = new_run_id or f"local-{int(time.time()) % 100000:05d}"
        self.messages = []
        self.tool_call_count = 0
        self.turn_count = 0
        self.started_at = time.time()
        self._build_graph()
        _print(f"{BGREEN}  [*] New session: {self.run_id}{RESET}")

    def uptime_str(self) -> str:
        elapsed = int(time.time() - self.started_at)
        return f"{elapsed // 60}m {elapsed % 60}s"

    def status_info(self) -> str:
        """Generate status info as formatted string."""
        lines = []
        lines.append(f"  {BGREEN}{BOLD}SESSION STATUS{RESET}")
        lines.append(f"  {_hr(BOX_H, 40)}")
        lines.append(f"  {DGREEN}Run ID    :{RESET} {BGREEN}{self.run_id}{RESET}")
        lines.append(f"  {DGREEN}Messages  :{RESET} {GREEN}{len(self.messages)}{RESET}")
        lines.append(f"  {DGREEN}Tool Calls:{RESET} {GREEN}{self.tool_call_count}{RESET}")
        lines.append(f"  {DGREEN}Turns     :{RESET} {GREEN}{self.turn_count}{RESET}")
        lines.append(f"  {DGREEN}Uptime    :{RESET} {GREEN}{self.uptime_str()}{RESET}")

        # Check run directory for chapter progress
        runs_dir = os.path.join(_PROJECT_ROOT, "runs", self.run_id)
        progress_path = os.path.join(runs_dir, "progress.json")
        if os.path.exists(progress_path):
            with open(progress_path) as f:
                progress = json.load(f)
            chapters = progress.get("chapters", {})
            total_chars = sum(c.get("chars", 0) for c in chapters.values())
            lines.append(f"  {DGREEN}Chapters  :{RESET} {GREEN}{len(chapters)}{RESET}")
            lines.append(f"  {DGREEN}Total Chars:{RESET} {GREEN}{total_chars:,}{RESET}")

        lines.append(f"  {_hr(BOX_H, 40)}")
        return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════
# Display Helpers — Matrix Style
# ═══════════════════════════════════════════════════════════════
def show_banner():
    """Show the Matrix-style welcome banner."""
    _clear_screen()
    _print(BANNER_ART)
    _print(f"  {BGREEN}Type your message to chat with the agent.{RESET}")
    _print(f"  {DGREEN}Commands: {BGREEN}/help{DGREEN}  {BGREEN}/new{DGREEN}  {BGREEN}/status{DGREEN}  {BGREEN}/history{DGREEN}  {BGREEN}/quit{RESET}")
    _print()


def show_help():
    """Show help text in Matrix style."""
    _print()
    _print(f"  {BGREEN}{BOLD}COMMANDS{RESET}")
    _print(f"  {_hr(BOX_H, 50)}")
    cmds = [
        ("/help",              "Show this help message"),
        ("/new [run_id]",      "Start a new session (optionally with a run ID)"),
        ("/status",            "Show session status and chapter progress"),
        ("/history",           "Show message history summary"),
        ("/init <title> <file>", "Initialize a run with paper title and original text file"),
        ("/quit",              "Exit the terminal UI"),
    ]
    for cmd, desc in cmds:
        _print(f"  {BGREEN}{cmd:<24}{RESET} {DGREEN}{desc}{RESET}")
    _print(f"  {_hr(BOX_H, 50)}")
    _print(f"  {YELLOW}{BOLD}HITL (Human-in-the-Loop){RESET}")
    _print(f"  {_hr(BOX_H, 50)}")
    hitl_cmds = [
        ("Ctrl+C",             "Pause agent execution"),
        ("/resume",            "Resume after pause"),
        ("/skip",              "Skip current tool call"),
        ("(type message)",     "Inject message into conversation"),
    ]
    for cmd, desc in hitl_cmds:
        _print(f"  {BGREEN}{cmd:<24}{RESET} {DGREEN}{desc}{RESET}")
    _print(f"  {_hr(BOX_H, 50)}")
    _print()


def show_tool_call(name: str, args: dict):
    """Display a tool call with box-drawing characters."""
    display_args = {}
    for k, v in args.items():
        sv = str(v)
        if len(sv) > 120:
            sv = sv[:117] + "..."
        display_args[k] = sv
    args_str = json.dumps(display_args, ensure_ascii=False)
    if len(args_str) > 200:
        args_str = args_str[:197] + "..."

    w = min(_term_width() - 4, 76)
    title = f" {name} "
    pad = max(0, w - len(name) - 4)
    left_pad = pad // 2
    right_pad = pad - left_pad

    _print()
    _print(f"  {GREEN}{BOX_TL}{BOX_H * left_pad}{BGREEN}{BOLD}{title}{RESET}{GREEN}{BOX_H * right_pad}{BOX_TR}{RESET}")
    # Wrap args
    arg_lines = _wrap_text(args_str, w - 2)
    for line in arg_lines:
        _print(f"  {GREEN}{BOX_V}{RESET} {DIM}{GREEN}{line}{RESET}{' ' * max(0, w - 1 - len(line))}{GREEN}{BOX_V}{RESET}")
    _print(f"  {GREEN}{BOX_BL}{BOX_H * w}{BOX_BR}{RESET}")


def show_tool_result(name: str, result: str):
    """Display a tool result inline."""
    preview = result[:200].replace("\n", " ")
    if len(result) > 200:
        preview += "..."
    _print(f"  {DIM}{GREEN}  ✓ {name} → {preview}{RESET}")


def show_agent_text(text: str):
    """Display agent text output in a bordered panel."""
    if not text.strip():
        return

    w = min(_term_width() - 4, 76)
    _print()
    _print(f"  {GREEN}{BOX_TL}{BOX_H * 2} AGENT {BOX_H * (w - 9)}{BOX_TR}{RESET}")

    for line in text.strip().split("\n"):
        # Word wrap long lines
        wrapped = _wrap_text(line, w - 2)
        if not wrapped:
            wrapped = [""]
        for wl in wrapped:
            padding = max(0, w - 1 - _visible_len(wl))
            _print(f"  {GREEN}{BOX_V}{RESET} {BGREEN}{wl}{' ' * padding}{GREEN}{BOX_V}{RESET}")

    _print(f"  {GREEN}{BOX_BL}{BOX_H * w}{BOX_BR}{RESET}")
    _print()


def show_user_input(text: str):
    """Echo user input in a subtle way."""
    _print(f"  {BWHITE}{BOLD}▸ You:{RESET} {WHITE}{text}{RESET}")


def _wrap_text(text: str, width: int) -> list:
    """Simple word-wrap to width."""
    if not text:
        return [""]

    lines = []
    for paragraph in text.split("\n"):
        if not paragraph:
            lines.append("")
            continue
        words = paragraph.split()
        current = ""
        for word in words:
            if current and len(current) + 1 + len(word) > width:
                lines.append(current)
                current = word
            else:
                current = f"{current} {word}" if current else word
        if current:
            lines.append(current)
    return lines if lines else [""]


def _visible_len(text: str) -> int:
    """Estimate visible length (strip ANSI codes)."""
    import re
    return len(re.sub(r'\033\[[0-9;]*m', '', text))


# ═══════════════════════════════════════════════════════════════
# HITL (Human-in-the-Loop) Helpers
# ═══════════════════════════════════════════════════════════════
def _hitl_prompt(interrupt_value) -> str:
    """Show HITL confirmation prompt and return user decision ('yes'/'no'/'skip')."""
    if isinstance(interrupt_value, dict):
        tool_name = interrupt_value.get("tool", "unknown")
        reason = interrupt_value.get("reason", "")
        args = interrupt_value.get("args", {})
    else:
        tool_name = str(interrupt_value)
        reason = ""
        args = {}

    _print()
    _print(f"  {YELLOW}{BOLD}⚠ CONFIRM TOOL EXECUTION{RESET}")
    _print(f"  {YELLOW}{BOX_TL}{BOX_H * 54}{BOX_TR}{RESET}")
    _print(f"  {YELLOW}{BOX_V}{RESET} {BWHITE}Tool  :{RESET} {BGREEN}{tool_name}{' ' * max(0, 46 - len(tool_name))}{YELLOW}{BOX_V}{RESET}")
    if reason:
        for line in _wrap_text(reason, 52):
            _print(f"  {YELLOW}{BOX_V}{RESET} {WHITE}{line}{' ' * max(0, 53 - _visible_len(line))}{YELLOW}{BOX_V}{RESET}")
    if args:
        args_str = json.dumps(args, ensure_ascii=False)
        if len(args_str) > 200:
            args_str = args_str[:197] + "..."
        for line in _wrap_text(args_str, 52):
            _print(f"  {YELLOW}{BOX_V}{RESET} {DIM}{GREEN}{line}{' ' * max(0, 53 - _visible_len(line))}{YELLOW}{BOX_V}{RESET}")
    _print(f"  {YELLOW}{BOX_BL}{BOX_H * 54}{BOX_BR}{RESET}")
    _print(f"  {BGREEN}y{RESET}/{BGREEN}yes{RESET} = confirm   {BRED}n{RESET}/{BRED}no{RESET} = cancel   {CYAN}skip{RESET} = skip this tool")
    _print()

    try:
        answer = input(f"  {YELLOW}{BOLD}? {RESET}").strip().lower()
    except (EOFError, KeyboardInterrupt):
        answer = "no"

    if answer in ("y", "yes", ""):
        return "yes"
    elif answer in ("n", "no"):
        return "no"
    else:
        return "skip"


def _handle_ctrl_c_pause(session: Session) -> tuple:
    """Handle Ctrl+C pause. Returns (action, message).
    
    action: 'resume', 'skip', 'inject'
    message: the injected message (if action=='inject')
    """
    _print(f"\n  {YELLOW}{BOLD}⚠ EXECUTION PAUSED (Ctrl+C){RESET}")
    _print(f"  {_hr(BOX_H, 50)}")
    _print(f"  {DGREEN}Type a message to inject into conversation,{RESET}")
    _print(f"  {BGREEN}/resume{DGREEN} to continue, or {BGREEN}/skip{DGREEN} to skip current tool.{RESET}")
    _print(f"  {_hr(BOX_H, 50)}")

    try:
        action = input(f"  {YELLOW}{BOLD}> {RESET}").strip()
    except (EOFError, KeyboardInterrupt):
        return "resume", ""

    if action == "/resume" or action == "":
        return "resume", ""
    elif action == "/skip":
        return "skip", ""
    else:
        return "inject", action


# ═══════════════════════════════════════════════════════════════
# Status Bar
# ═══════════════════════════════════════════════════════════════
def show_output_files(session: Session):
    """Check for output files in the run directory and display them."""
    run_dir = os.path.join(_PROJECT_ROOT, "runs", session.run_id)
    if not os.path.isdir(run_dir):
        return

    output_files = []

    # Check for PDF
    pdf_path = os.path.join(run_dir, "output.pdf")
    if os.path.isfile(pdf_path):
        size = os.path.getsize(pdf_path)
        if size > 1024 * 1024:
            size_str = f"{size / (1024 * 1024):.1f} MB"
        else:
            size_str = f"{size / 1024:.0f} KB"
        output_files.append(("pdf", f"runs/{session.run_id}/output.pdf", size_str))

    # Check for chapters
    chapters_dir = os.path.join(run_dir, "chapters")
    if os.path.isdir(chapters_dir):
        import re as _re
        ch_files = sorted(
            [f for f in os.listdir(chapters_dir) if f.endswith(".txt")],
            key=lambda x: int(_re.search(r'\d+', x).group()) if _re.search(r'\d+', x) else 0,
        )
        for cf in ch_files:
            cf_path = os.path.join(chapters_dir, cf)
            size = os.path.getsize(cf_path)
            if size > 1024 * 1024:
                size_str = f"{size / (1024 * 1024):.1f} MB"
            else:
                size_str = f"{size / 1024:.0f} KB"
            output_files.append(("txt", f"runs/{session.run_id}/chapters/{cf}", size_str))

    if not output_files:
        return

    _print()
    _print(f"  {BGREEN}{BOLD}═══════════════════════════════════════════════════════════════════{RESET}")
    _print(f"  {BGREEN}{BOLD}  ✓ OUTPUT FILES{RESET}")
    _print(f"  {GREEN}{BOX_TL}{BOX_H * 52}{BOX_TR}{RESET}")
    for ftype, fpath, fsize in output_files:
        icon = "📄" if ftype == "pdf" else "📝"
        entry = f"{icon} {fpath} ({fsize})"
        pad = max(0, 52 - _visible_len(entry) - 1)
        _print(f"  {GREEN}{BOX_V}{RESET} {BGREEN}{entry}{' ' * pad}{GREEN}{BOX_V}{RESET}")
    _print(f"  {GREEN}{BOX_BL}{BOX_H * 52}{BOX_BR}{RESET}")
    # Show xdg-open hint for PDFs
    for ftype, fpath, _ in output_files:
        if ftype == "pdf":
            _print(f"  {DGREEN}Open PDF: {BGREEN}xdg-open {fpath}{RESET}")
    _print(f"  {BGREEN}{BOLD}═══════════════════════════════════════════════════════════════════{RESET}")
    _print()


def show_status_bar(session: Session, current_step: str = "idle"):
    """Show a bottom status bar."""
    w = _term_width()
    left = f" ◇ {current_step}"
    right = f"tools:{session.tool_call_count} │ turns:{session.turn_count} │ {session.run_id} "
    mid_pad = max(1, w - len(left) - len(right) - 4)
    bar = f"  {DARKGRN}{BOLD} {left}{' ' * mid_pad}{right} {RESET}"
    _print(bar)


# ═══════════════════════════════════════════════════════════════
# Core: Stream Agent Execution Locally
# ═══════════════════════════════════════════════════════════════
async def run_agent_turn(session: Session, user_input: str):
    """Run one agent turn with HITL support.

    Handles:
    - Normal streaming with token-by-token display
    - Interrupt-based tool confirmation prompts
    - KeyboardInterrupt (Ctrl+C) for pause/inject/resume
    """

    session.messages.append(HumanMessage(content=user_input))
    session.turn_count += 1

    show_user_input(user_input)
    _print()

    # Status: working
    show_status_bar(session, "processing...")
    _print()

    config = {"recursion_limit": 100, "configurable": {"thread_id": session.run_id}}
    input_data = {"messages": session.messages}
    had_content = False

    # ── HITL loop: repeat until no more interrupts ──
    while True:
        is_streaming = False
        last_tool_name = ""
        got_interrupt = False
        got_error = False

        def _close_panel():
            nonlocal is_streaming
            if is_streaming:
                sys.stdout.write("\n")
                sys.stdout.flush()
                w = min(_term_width() - 4, 76)
                _print(f"  {GREEN}{BOX_BL}{BOX_H * w}{BOX_BR}{RESET}")
                _print()
                is_streaming = False

        try:
            async for event in session.graph.astream_events(
                input_data,
                version="v2",
                config=config,
            ):
                kind = event.get("event", "")
                data = event.get("data", {})
                ename = event.get("name", "")

                # ── Streaming tokens from LLM ──
                if kind == "on_chat_model_stream":
                    chunk = data.get("chunk")
                    if chunk and hasattr(chunk, "content") and chunk.content:
                        if not is_streaming:
                            is_streaming = True
                            had_content = True
                            # Start agent response header
                            _print(f"  {GREEN}{BOX_TL}{BOX_H * 2} AGENT {BOX_H * 60}{BOX_TR}{RESET}")
                            sys.stdout.write(f"  {GREEN}{BOX_V}{RESET} ")
                        sys.stdout.write(f"{GREEN}{chunk.content}{RESET}")
                        sys.stdout.flush()

                # ── LLM done (may have tool_calls) ──
                elif kind == "on_chat_model_end":
                    _close_panel()
                    output = data.get("output")
                    if isinstance(output, AIMessage) and output.tool_calls:
                        for tc in output.tool_calls:
                            session.tool_call_count += 1
                            show_tool_call(tc.get("name", "?"), tc.get("args", {}))

                # ── Track tool names from tool start ──
                elif kind == "on_tool_start":
                    last_tool_name = data.get("name", "") or ename or "tool"

                # ── Tool finished ──
                elif kind == "on_tool_end":
                    _close_panel()
                    tool_output = data.get("output", "")
                    tname = last_tool_name or ename or "tool"
                    if isinstance(tool_output, ToolMessage):
                        tname = tool_output.name or tname
                        tool_output = tool_output.content
                    show_tool_result(tname, str(tool_output)[:300])

        except KeyboardInterrupt:
            _close_panel()
            got_interrupt = True

            action, msg = _handle_ctrl_c_pause(session)

            if action == "resume":
                _print(f"  {BGREEN}[✓] Continuing execution...{RESET}")
                input_data = Command(resume="yes")
            elif action == "skip":
                _print(f"  {CYAN}[→] Skipping current tool...{RESET}")
                input_data = Command(resume="skip")
            else:
                # Inject message into conversation
                session.messages.append(HumanMessage(content=msg))
                input_data = {"messages": session.messages}
                _print(f"  {BGREEN}[✓] Message injected: {WHITE}{msg}{RESET}")

            _print()
            show_status_bar(session, "resuming...")
            _print()
            continue

        except Exception as e:
            _close_panel()
            got_error = True
            _print(f"\n  {BRED}[!] Error: {type(e).__name__}: {e}{RESET}")
            if os.getenv("DEBUG"):
                traceback.print_exc()
            break

        # ── Check for interrupts in graph state ──
        try:
            graph_state = session.graph.get_state(config)
            if graph_state and graph_state.interrupts:
                _close_panel()
                got_interrupt = True

                for ig in graph_state.interrupts:
                    answer = _hitl_prompt(ig.value)
                    if answer == "no":
                        _print(f"  {BRED}[✗] Operation cancelled{RESET}")
                    elif answer == "skip":
                        _print(f"  {CYAN}[→] Skipped{RESET}")
                    else:
                        _print(f"  {BGREEN}[✓] Confirmed, continuing...{RESET}")

                    input_data = Command(resume=answer)

                _print()
                show_status_bar(session, "resuming...")
                _print()
                continue
        except Exception as e:
            if os.getenv("DEBUG"):
                _print(f"  {DIM}State check error: {e}{RESET}")

        if not got_interrupt and not got_error:
            break  # No interrupt, no error — done

    # Sync state from graph
    try:
        graph_state = session.graph.get_state(config)
        if graph_state and graph_state.values:
            session.messages = list(graph_state.values.get("messages", []))
    except Exception as e:
        if os.getenv("DEBUG"):
            _print(f"  {DIM}Could not get graph state: {e}{RESET}")

    if not had_content and session.tool_call_count == 0:
        _print(f"  {DIM}(No response from agent){RESET}")

    show_status_bar(session, "idle")
    _print()

    # Show output files if any exist
    show_output_files(session)


# ═══════════════════════════════════════════════════════════════
# Command Handlers
# ═══════════════════════════════════════════════════════════════
def handle_init(session: Session, args: list):
    """Handle /init command: initialize a run with paper title and file."""
    if len(args) < 2:
        _print(f"  {BRED}[!] Usage: /init <paper_title> <original_file_path>{RESET}")
        return

    title = args[0]
    file_path = " ".join(args[1:])

    if not os.path.exists(file_path):
        _print(f"  {BRED}[!] File not found: {file_path}{RESET}")
        return

    with open(file_path, "r", encoding="utf-8") as f:
        original_text = f.read()

    # ── HITL: Confirm before init_run ──
    _print(f"  {YELLOW}{BOLD}⚠ CONFIRM: init_run{RESET}")
    _print(f"  {YELLOW}{BOX_TL}{BOX_H * 54}{BOX_TR}{RESET}")
    _print(f"  {YELLOW}{BOX_V}{RESET} {BWHITE}Title :{RESET} {BGREEN}{title}{' ' * max(0, 46 - len(title))}{YELLOW}{BOX_V}{RESET}")
    _print(f"  {YELLOW}{BOX_V}{RESET} {BWHITE}File  :{RESET} {WHITE}{file_path}{' ' * max(0, 46 - len(file_path))}{YELLOW}{BOX_V}{RESET}")
    _print(f"  {YELLOW}{BOX_V}{RESET} {BWHITE}Chars :{RESET} {WHITE}{len(original_text):,}{' ' * max(0, 46 - len(f'{len(original_text):,}'))}{YELLOW}{BOX_V}{RESET}")
    _print(f"  {YELLOW}{BOX_BL}{BOX_H * 54}{BOX_BR}{RESET}")

    try:
        answer = input(f"  {YELLOW}{BOLD}? Proceed? (y/n) {RESET}").strip().lower()
    except (EOFError, KeyboardInterrupt):
        answer = "n"

    if answer not in ("y", "yes", ""):
        _print(f"  {YELLOW}[!] Cancelled{RESET}")
        return

    from agent.graph import init_run, set_current_run_id
    set_current_run_id(session.run_id)
    init_run(session.run_id, original_text, paper_title=title)

    _print(f"  {BGREEN}[✓] Initialized run '{session.run_id}' with paper '{title}'{RESET}")
    _print(f"  {DIM}Original text: {len(original_text):,} chars{RESET}")


def show_history(session: Session):
    """Show message history in Matrix style."""
    if not session.messages:
        _print(f"  {DIM}No messages yet.{RESET}")
        return

    _print()
    _print(f"  {BGREEN}{BOLD}MESSAGE HISTORY{RESET}")
    _print(f"  {_hr(BOX_H, 60)}")
    for i, msg in enumerate(session.messages):
        role = type(msg).__name__.replace("Message", "")
        content = ""
        if hasattr(msg, "content"):
            content = str(msg.content)[:80].replace("\n", " ")
        if hasattr(msg, "tool_calls") and msg.tool_calls:
            names = [tc.get("name", "?") for tc in msg.tool_calls]
            content = f"→ tools: {', '.join(names)}"

        role_color = GREEN if role == "AI" else (BWHITE if role == "Human" else CYAN)
        _print(f"  {DIM}[{i:>3}]{RESET} {role_color}{role:<10}{RESET} {DGREEN}{content}{RESET}")
    _print(f"  {_hr(BOX_H, 60)}")
    _print()


def handle_command(session: Session, line: str) -> bool:
    """Handle slash commands. Returns True if should exit."""
    parts = line.strip().split()
    cmd = parts[0].lower()
    args = parts[1:] if len(parts) > 1 else []

    if cmd in ("/quit", "/exit", "/q"):
        _print(f"\n  {DIM}Goodbye, Neo.{RESET}")
        _print(f"  {GREEN}{DIM}The Matrix has you...{RESET}\n")
        return True

    elif cmd == "/help":
        show_help()

    elif cmd == "/new":
        new_id = args[0] if args else ""
        session.reset(new_id)

    elif cmd == "/status":
        _print(session.status_info())

    elif cmd == "/history":
        show_history(session)

    elif cmd == "/init":
        handle_init(session, args)

    else:
        _print(f"  {YELLOW}[?] Unknown command: {cmd}. Type /help for commands.{RESET}")

    return False


# ═══════════════════════════════════════════════════════════════
# Input Prompt
# ═══════════════════════════════════════════════════════════════
def get_input(session: Session) -> Optional[str]:
    """Get user input with Matrix-style prompt."""
    try:
        prompt = f"{BGREEN}{BOLD}>{RESET} "
        return input(prompt)
    except (EOFError, KeyboardInterrupt):
        return None


# ═══════════════════════════════════════════════════════════════
# Main Loop
# ═══════════════════════════════════════════════════════════════
async def main_async(run_id: str = ""):
    """Main async loop."""
    session = Session(run_id)
    show_banner()

    _print(f"  {DGREEN}Session: {BGREEN}{session.run_id}{RESET}")
    _print()
    show_status_bar(session, "ready")
    _print()

    while True:
        line = get_input(session)
        if line is None:
            _print(f"\n  {DIM}Goodbye, Neo.{RESET}\n")
            break

        line = line.strip()
        if not line:
            continue

        if line.startswith("/"):
            if handle_command(session, line):
                break
            continue

        try:
            await run_agent_turn(session, line)
        except Exception as e:
            _print(f"  {BRED}[!] Turn error: {type(e).__name__}: {e}{RESET}")
            if os.getenv("DEBUG"):
                traceback.print_exc()


def main():
    parser = argparse.ArgumentParser(description="Paper Rewriter Terminal UI (Matrix Mode)")
    parser.add_argument("--run-id", default="", help="Run ID for the session")
    parser.add_argument("--debug", action="store_true", help="Enable debug output")
    args = parser.parse_args()

    if args.debug:
        os.environ["DEBUG"] = "1"

    asyncio.run(main_async(args.run_id))


if __name__ == "__main__":
    main()
