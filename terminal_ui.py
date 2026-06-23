#!/usr/bin/env python3
"""Terminal UI for Paper Rewriter LangGraph Agent — LOCAL mode.

Clean full-screen TUI inspired by Hermes Agent's layout.
Uses alternate screen buffer for immersive experience.
Runs the agent graph in-process. No remote server needed.

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
import re
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

# Alternate screen sequences
ALT_SCREEN_ON  = "\033[?1049h"
ALT_SCREEN_OFF = "\033[?1049l"

# Cursor visibility
CURSOR_HIDE = "\033[?25l"
CURSOR_SHOW = "\033[?25h"

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
def _term_size() -> tuple:
    """Get terminal (width, height)."""
    try:
        sz = shutil.get_terminal_size((80, 24))
        return sz.columns, sz.lines
    except Exception:
        return 80, 24


def _term_width() -> int:
    return _term_size()[0]


def _term_height() -> int:
    return _term_size()[1]


def _visible_len(text: str) -> int:
    """Estimate visible length (strip ANSI codes)."""
    return len(re.sub(r'\033\[[0-9;]*m', '', text))


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


# ═══════════════════════════════════════════════════════════════
# Full-Screen TUI Renderer
# ═══════════════════════════════════════════════════════════════
class TUIRenderer:
    """Manages the full-screen alternate-buffer TUI."""

    def __init__(self):
        self._alt_screen = False
        self._transcript: list[str] = []   # lines of transcript (with ANSI)
        self._scroll_offset = 0            # lines scrolled up from bottom

    # ── Alternate screen ──

    def enter_alt_screen(self):
        if not self._alt_screen:
            sys.stdout.write(CURSOR_HIDE)
            sys.stdout.write(ALT_SCREEN_ON)
            sys.stdout.flush()
            self._alt_screen = True

    def leave_alt_screen(self):
        if self._alt_screen:
            sys.stdout.write(ALT_SCREEN_OFF)
            sys.stdout.write(CURSOR_SHOW)
            sys.stdout.flush()
            self._alt_screen = False

    # ── Drawing primitives ──

    def _move_to(self, row: int, col: int = 1):
        """Move cursor to row,col (1-based)."""
        sys.stdout.write(f"\033[{row};{col}H")

    def _clear_line(self):
        sys.stdout.write("\033[2K")

    def _clear_screen(self):
        sys.stdout.write("\033[2J")

    def _write(self, text: str):
        sys.stdout.write(text)
        sys.stdout.flush()

    # ── Transcript management ──

    def add_lines(self, lines: list[str]):
        """Append lines to the transcript buffer."""
        self._transcript.extend(lines)

    def add_line(self, line: str):
        self._transcript.append(line)

    # ── Full-screen redraw ──

    def draw(self, session, status: str = "ready"):
        """Redraw the entire screen.

        Layout (top to bottom):
          Row 1:    Header
          Row 2..h-3: Transcript area (scrollable, fills middle)
          Row h-2:  Status rule (thin green separator)
          Row h-1:  Input area with ▸ prompt
          Row h:    Status bar
        """
        w, h = _term_size()

        # Layout: header(1) + transcript area + statusrule(1) + input(1) + statusbar(1)
        # That's 4 reserved lines; transcript gets the rest
        transcript_rows = max(1, h - 4)

        # Hide cursor during redraw
        sys.stdout.write(CURSOR_HIDE)

        self._move_to(1, 1)
        self._clear_screen()

        # ── Header (row 1) ──
        header = (
            f"{BGREEN}{BOLD} 📝 PAPER REWRITER{RESET}"
            f" {DGREEN}│{RESET}"
            f" {DGREEN}Session:{RESET} {BGREEN}{session.run_id}{RESET}"
            f" {DGREEN}│{RESET}"
            f" {DGREEN}tools:{RESET}{GREEN}{session.tool_call_count}{RESET}"
            f" {DGREEN}│{RESET}"
            f" {DGREEN}turns:{RESET}{GREEN}{session.turn_count}{RESET}"
        )
        self._write(header)
        # Pad rest of header line
        hpad = w - _visible_len(header)
        if hpad > 0:
            self._write(f"{' ' * hpad}")

        # ── Transcript area (rows 2 .. h-3) ──
        # Calculate which lines to show (bottom-aligned, scrolled up)
        total_lines = len(self._transcript)
        # Show the last `transcript_rows` lines (minus scroll offset)
        end_idx = max(0, total_lines - self._scroll_offset)
        start_idx = max(0, end_idx - transcript_rows)
        visible = self._transcript[start_idx:end_idx]

        row = 2
        for line in visible:
            self._move_to(row, 1)
            self._clear_line()
            # Truncate to terminal width
            vl = _visible_len(line)
            if vl > w:
                # Simple truncation — strip from the end
                display = line[:w + (len(line) - vl)]
            else:
                display = line
            self._write(display)
            row += 1

        # Fill remaining transcript rows with blank
        while row < 2 + transcript_rows:
            self._move_to(row, 1)
            self._clear_line()
            row += 1

        # ── Status rule / separator (row h-2) ──
        sep_row = h - 2
        self._move_to(sep_row, 1)
        self._write(f"{DGREEN}{'─' * w}{RESET}")

        # ── Input area (row h-1) ──
        input_row = h - 1
        self._move_to(input_row, 1)
        self._clear_line()
        self._write(f"{BGREEN}{BOLD}▸{RESET} ")

        # ── Status bar (row h) ──
        status_row = h
        self._move_to(status_row, 1)
        self._clear_line()
        left = f"▸ {status}"
        right = f"tools:{session.tool_call_count} │ turns:{session.turn_count} │ {session.run_id}"
        mid_pad = max(1, w - len(left) - len(right) - 2)
        bar = f"{DGREEN}{left}{' ' * mid_pad}{right}{RESET}"
        # Pad to fill width
        bar_visible = _visible_len(bar)
        if bar_visible < w:
            bar = bar[:-len(RESET)] + " " * (w - bar_visible) + RESET
        self._write(bar)

        # Show cursor on input line after the prompt
        self._move_to(input_row, 3)
        sys.stdout.write(CURSOR_SHOW)
        sys.stdout.flush()

    def draw_streaming(self, session):
        """Lightweight: update only the last transcript line and status bar."""
        w, h = _term_size()
        transcript_rows = max(1, h - 4)

        # Move to last line of transcript area and update it
        row = min(2 + transcript_rows - 1, h - 3)
        if self._transcript:
            last_line = self._transcript[-1]
            self._move_to(row, 1)
            self._clear_line()
            truncated = last_line[:w-1]
            self._write(truncated)

        # Update status bar
        self._move_to(h, 1)
        self._clear_line()
        status_text = f" {GREEN}▸{RESET} {DGREEN}streaming...{RESET}"
        right = f"tools:{session.tool_call_count} │ turns:{session.turn_count} │ {session.run_id}"
        padding = max(1, w - _visible_len(status_text) - _visible_len(right) - 2)
        self._write(f"{status_text}{' ' * padding}{DGREEN}{right}{RESET}")
        sys.stdout.flush()

    def draw_input_line(self, session, status: str = "ready"):
        """Lightweight: just redraw the input line + status bar."""
        w, h = _term_size()
        input_row = h - 1
        self._move_to(input_row, 1)
        self._clear_line()
        self._write(f"{BGREEN}{BOLD}▸{RESET} ")

        status_row = h
        self._move_to(status_row, 1)
        self._clear_line()
        left = f"▸ {status}"
        right = f"tools:{session.tool_call_count} │ turns:{session.turn_count} │ {session.run_id}"
        mid_pad = max(1, w - len(left) - len(right) - 2)
        bar = f"{DGREEN}{left}{' ' * mid_pad}{right}{RESET}"
        bar_visible = _visible_len(bar)
        if bar_visible < w:
            bar = bar[:-len(RESET)] + " " * (w - bar_visible) + RESET
        self._write(bar)

        self._move_to(input_row, 3)
        sys.stdout.flush()


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

    def reset(self, new_run_id: str = ""):
        """Reset session for a new conversation."""
        self.run_id = new_run_id or f"local-{int(time.time()) % 100000:05d}"
        self.messages = []
        self.tool_call_count = 0
        self.turn_count = 0
        self.started_at = time.time()
        self._build_graph()

    def uptime_str(self) -> str:
        elapsed = int(time.time() - self.started_at)
        return f"{elapsed // 60}m {elapsed % 60}s"

    def status_info(self) -> list[str]:
        """Generate status info as list of lines."""
        lines = []
        lines.append(f"{BGREEN}{BOLD}SESSION STATUS{RESET}")
        lines.append(f"{DGREEN}{'─' * 40}{RESET}")
        lines.append(f"{DGREEN}Run ID    :{RESET} {BGREEN}{self.run_id}{RESET}")
        lines.append(f"{DGREEN}Messages  :{RESET} {GREEN}{len(self.messages)}{RESET}")
        lines.append(f"{DGREEN}Tool Calls:{RESET} {GREEN}{self.tool_call_count}{RESET}")
        lines.append(f"{DGREEN}Turns     :{RESET} {GREEN}{self.turn_count}{RESET}")
        lines.append(f"{DGREEN}Uptime    :{RESET} {GREEN}{self.uptime_str()}{RESET}")

        # Check run directory for chapter progress
        runs_dir = os.path.join(_PROJECT_ROOT, "runs", self.run_id)
        progress_path = os.path.join(runs_dir, "progress.json")
        if os.path.exists(progress_path):
            with open(progress_path) as f:
                progress = json.load(f)
            chapters = progress.get("chapters", {})
            total_chars = sum(c.get("chars", 0) for c in chapters.values())
            lines.append(f"{DGREEN}Chapters  :{RESET} {GREEN}{len(chapters)}{RESET}")
            lines.append(f"{DGREEN}Total Chars:{RESET} {GREEN}{total_chars:,}{RESET}")

        lines.append(f"{DGREEN}{'─' * 40}{RESET}")
        return lines


# ═══════════════════════════════════════════════════════════════
# Global renderer
# ═══════════════════════════════════════════════════════════════
_tui = TUIRenderer()


# ═══════════════════════════════════════════════════════════════
# Display Helpers — add to transcript buffer
# ═══════════════════════════════════════════════════════════════
def _transcript_print(text: str = ""):
    """Add a line (or multiple lines) to the transcript."""
    for line in text.split("\n"):
        _tui.add_line(line)


def show_welcome():
    """Show welcome message in transcript."""
    _transcript_print(f"{BGREEN}{BOLD}📝 PAPER REWRITER{RESET} {DGREEN}— LangGraph Agent · Local Mode{RESET}")
    _transcript_print(f"{DGREEN}Type your message to chat. Commands: /help · /new · /status · /history · /quit{RESET}")
    _transcript_print()


def show_turn_separator():
    """Add a turn separator line between user messages."""
    w = _term_width()
    _transcript_print(f"{DGREEN}{'─' * min(w, 60)}{RESET}")


def show_user_input(text: str):
    """Echo user input in transcript."""
    # Add turn separator before each new user message (except the first)
    # Count existing user messages in transcript
    user_count = sum(1 for l in _tui._transcript if l.startswith(f"{BWHITE}{BOLD}▸ You:"))
    if user_count > 0:
        show_turn_separator()
    _transcript_print(f"{BWHITE}{BOLD}▸ You:{RESET} {WHITE}{text}{RESET}")


def show_agent_text_line(text: str):
    """Add a line of agent text with left border."""
    _transcript_print(f"{GREEN}│{RESET} {BGREEN}{text}{RESET}")


def show_tool_call(name: str, args: dict):
    """Display a tool call compactly."""
    display_args = {}
    for k, v in args.items():
        sv = str(v)
        if len(sv) > 100:
            sv = sv[:97] + "..."
        display_args[k] = sv
    args_str = json.dumps(display_args, ensure_ascii=False)
    if len(args_str) > 160:
        args_str = args_str[:157] + "..."

    _transcript_print(f"{GREEN}{BOX_TL}{BOX_H * 2}{RESET} {BGREEN}{BOLD}{name}{RESET} {GREEN}{BOX_H * 2}{RESET}")
    for line in _wrap_text(args_str, _term_width() - 4):
        _transcript_print(f"{DIM}{GREEN}  {line}{RESET}")


def show_tool_result(name: str, result: str):
    """Display a tool result inline."""
    preview = result[:150].replace("\n", " ")
    if len(result) > 150:
        preview += "..."
    _transcript_print(f"{DIM}{GREEN}  ✓ {name} → {preview}{RESET}")


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
        def _sort_key(x):
            m = re.search(r'\d+', x)
            return int(m.group()) if m else 0
        ch_files = sorted(
            [f for f in os.listdir(chapters_dir) if f.endswith(".txt")],
            key=_sort_key,
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

    _transcript_print(f"{BGREEN}{BOLD}✓ OUTPUT FILES{RESET}")
    for ftype, fpath, fsize in output_files:
        icon = "📄" if ftype == "pdf" else "📝"
        _transcript_print(f"{GREEN}  {icon} {fpath} ({fsize}){RESET}")
    for ftype, fpath, _ in output_files:
        if ftype == "pdf":
            _transcript_print(f"{DGREEN}  Open: xdg-open {fpath}{RESET}")
    _transcript_print()


def show_help():
    """Show help text."""
    _transcript_print(f"{BGREEN}{BOLD}COMMANDS{RESET}")
    _transcript_print(f"{DGREEN}{'─' * 40}{RESET}")
    cmds = [
        ("/help",              "Show this help message"),
        ("/new [run_id]",      "Start a new session"),
        ("/status",            "Show session status and chapter progress"),
        ("/history",           "Show message history summary"),
        ("/init <title> <file>", "Initialize a run with paper title and text file"),
        ("/quit",              "Exit the terminal UI"),
    ]
    for cmd, desc in cmds:
        _transcript_print(f"  {BGREEN}{cmd:<24}{RESET} {DGREEN}{desc}{RESET}")
    _transcript_print(f"{DGREEN}{'─' * 40}{RESET}")
    _transcript_print(f"{YELLOW}{BOLD}HITL (Human-in-the-Loop){RESET}")
    _transcript_print(f"{DGREEN}{'─' * 40}{RESET}")
    hitl_cmds = [
        ("Ctrl+C",             "Pause agent execution"),
        ("/resume",            "Resume after pause"),
        ("/skip",              "Skip current tool call"),
        ("(type message)",     "Inject message into conversation"),
    ]
    for cmd, desc in hitl_cmds:
        _transcript_print(f"  {BGREEN}{cmd:<24}{RESET} {DGREEN}{desc}{RESET}")
    _transcript_print(f"{DGREEN}{'─' * 40}{RESET}")
    _transcript_print()


def show_history(session: Session):
    """Show message history."""
    if not session.messages:
        _transcript_print(f"{DIM}  No messages yet.{RESET}")
        return

    _transcript_print(f"{BGREEN}{BOLD}MESSAGE HISTORY{RESET}")
    _transcript_print(f"{DGREEN}{'─' * 50}{RESET}")
    for i, msg in enumerate(session.messages):
        role = type(msg).__name__.replace("Message", "")
        content = ""
        if hasattr(msg, "content"):
            content = str(msg.content)[:70].replace("\n", " ")
        if hasattr(msg, "tool_calls") and msg.tool_calls:
            names = [tc.get("name", "?") for tc in msg.tool_calls]
            content = f"→ tools: {', '.join(names)}"

        role_color = GREEN if role == "AI" else (BWHITE if role == "Human" else CYAN)
        _transcript_print(f"{DIM}[{i:>3}]{RESET} {role_color}{role:<10}{RESET} {DGREEN}{content}{RESET}")
    _transcript_print(f"{DGREEN}{'─' * 50}{RESET}")
    _transcript_print()


# ═══════════════════════════════════════════════════════════════
# HITL (Human-in-the-Loop) Helpers
# ═══════════════════════════════════════════════════════════════
def _hitl_prompt(interrupt_value, session: Session) -> str:
    """Show HITL confirmation prompt in transcript and get user decision."""
    if isinstance(interrupt_value, dict):
        tool_name = interrupt_value.get("tool", "unknown")
        reason = interrupt_value.get("reason", "")
        args = interrupt_value.get("args", {})
    else:
        tool_name = str(interrupt_value)
        reason = ""
        args = {}

    _transcript_print(f"{YELLOW}{BOLD}⚠ CONFIRM │{RESET} {BGREEN}{tool_name}{RESET} {YELLOW}{BOLD}│ y/n/skip{RESET}")
    if reason:
        for line in _wrap_text(reason, _term_width() - 4):
            _transcript_print(f"{YELLOW}  {line}{RESET}")
    if args:
        args_str = json.dumps(args, ensure_ascii=False)
        if len(args_str) > 160:
            args_str = args_str[:157] + "..."
        for line in _wrap_text(args_str, _term_width() - 4):
            _transcript_print(f"{DIM}{GREEN}  {line}{RESET}")

    # Redraw screen and wait for input
    _tui.draw(session, "awaiting confirmation")

    try:
        w, h = _term_size()
        input_row = h - 1
        _tui._move_to(input_row, 1)
        _tui._clear_line()
        _tui._write(f"{YELLOW}{BOLD}?{RESET} ")
        sys.stdout.flush()
        answer = input("").strip().lower()
    except (EOFError, KeyboardInterrupt):
        answer = "no"

    if answer in ("y", "yes", ""):
        return "yes"
    elif answer in ("n", "no"):
        return "no"
    else:
        return "skip"


def _handle_ctrl_c_pause(session: Session) -> tuple:
    """Handle Ctrl+C pause. Returns (action, message)."""
    _transcript_print(f"{YELLOW}{BOLD}⚠ EXECUTION PAUSED (Ctrl+C){RESET}")
    _transcript_print(f"{DGREEN}  Type message to inject, /resume to continue, /skip to skip tool.{RESET}")

    _tui.draw(session, "paused")

    try:
        w, h = _term_size()
        input_row = h - 1
        _tui._move_to(input_row, 1)
        _tui._clear_line()
        _tui._write(f"{YELLOW}{BOLD}>{RESET} ")
        sys.stdout.flush()
        action = input("").strip()
    except (EOFError, KeyboardInterrupt):
        return "resume", ""

    if action == "/resume" or action == "":
        return "resume", ""
    elif action == "/skip":
        return "skip", ""
    else:
        return "inject", action


def _get_input_in_alt(session: Session, prompt_text: str = "▸") -> Optional[str]:
    """Get user input while in alternate screen mode."""
    w, h = _term_size()
    input_row = h - 1
    _tui._move_to(input_row, 1)
    _tui._clear_line()
    _tui._write(f"{BGREEN}{BOLD}{prompt_text}{RESET} ")
    sys.stdout.flush()
    try:
        return input("")
    except (EOFError, KeyboardInterrupt):
        return None


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
    _tui.draw(session, "processing...")

    config = {"recursion_limit": 100, "configurable": {"thread_id": session.run_id}}
    input_data = {"messages": session.messages}
    had_content = False
    current_agent_line = ""

    # ── HITL loop: repeat until no more interrupts ──
    while True:
        is_streaming = False
        last_tool_name = ""
        got_interrupt = False
        got_error = False

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
                            current_agent_line = f"{GREEN}│{RESET} "
                        # Build up text — flush to transcript periodically
                        token = chunk.content
                        current_agent_line += f"{GREEN}{token}{RESET}"
                        # For streaming display: add to transcript and redraw
                        # We'll accumulate and flush on model end
                        # For now, update transcript with partial line
                        # Remove previous partial if it's still being built
                        if _tui._transcript and _tui._transcript[-1].startswith(f"{GREEN}│{RESET}"):
                            _tui._transcript[-1] = current_agent_line
                        else:
                            _tui.add_line(current_agent_line)
                        _tui.draw_streaming(session)

                # ── LLM done (may have tool_calls) ──
                elif kind == "on_chat_model_end":
                    if is_streaming:
                        is_streaming = False
                        current_agent_line = ""
                    output = data.get("output")
                    if isinstance(output, AIMessage) and output.tool_calls:
                        for tc in output.tool_calls:
                            session.tool_call_count += 1
                            show_tool_call(tc.get("name", "?"), tc.get("args", {}))
                    _tui.draw(session, "processing...")

                # ── Track tool names from tool start ──
                elif kind == "on_tool_start":
                    last_tool_name = data.get("name", "") or ename or "tool"

                # ── Tool finished ──
                elif kind == "on_tool_end":
                    if is_streaming:
                        is_streaming = False
                        current_agent_line = ""
                    tool_output = data.get("output", "")
                    tname = last_tool_name or ename or "tool"
                    if isinstance(tool_output, ToolMessage):
                        tname = tool_output.name or tname
                        tool_output = tool_output.content
                    show_tool_result(tname, str(tool_output)[:300])
                    _tui.draw(session, "processing...")

        except KeyboardInterrupt:
            if is_streaming:
                is_streaming = False
                current_agent_line = ""
            got_interrupt = True

            action, msg = _handle_ctrl_c_pause(session)

            if action == "resume":
                _transcript_print(f"{BGREEN}[✓] Continuing execution...{RESET}")
                input_data = Command(resume="yes")
            elif action == "skip":
                _transcript_print(f"{CYAN}[→] Skipping current tool...{RESET}")
                input_data = Command(resume="skip")
            else:
                # Inject message into conversation
                session.messages.append(HumanMessage(content=msg))
                input_data = {"messages": session.messages}
                _transcript_print(f"{BGREEN}[✓] Message injected: {WHITE}{msg}{RESET}")

            _tui.draw(session, "resuming...")
            continue

        except Exception as e:
            if is_streaming:
                is_streaming = False
                current_agent_line = ""
            got_error = True
            _transcript_print(f"{BRED}[!] Error: {type(e).__name__}: {e}{RESET}")
            if os.getenv("DEBUG"):
                traceback.print_exc()
            _tui.draw(session, "error")
            break

        # ── Check for interrupts in graph state ──
        try:
            graph_state = session.graph.get_state(config)
            if graph_state and graph_state.interrupts:
                got_interrupt = True

                for ig in graph_state.interrupts:
                    answer = _hitl_prompt(ig.value, session)
                    if answer == "no":
                        _transcript_print(f"{BRED}[✗] Operation cancelled{RESET}")
                    elif answer == "skip":
                        _transcript_print(f"{CYAN}[→] Skipped{RESET}")
                    else:
                        _transcript_print(f"{BGREEN}[✓] Confirmed, continuing...{RESET}")

                    input_data = Command(resume=answer)

                _tui.draw(session, "resuming...")
                continue
        except Exception as e:
            if os.getenv("DEBUG"):
                _transcript_print(f"{DIM}State check error: {e}{RESET}")

        if not got_interrupt and not got_error:
            break  # No interrupt, no error — done

    # Sync state from graph
    try:
        graph_state = session.graph.get_state(config)
        if graph_state and graph_state.values:
            session.messages = list(graph_state.values.get("messages", []))
    except Exception as e:
        if os.getenv("DEBUG"):
            _transcript_print(f"{DIM}Could not get graph state: {e}{RESET}")

    if not had_content and session.tool_call_count == 0:
        _transcript_print(f"{DIM}(No response from agent){RESET}")

    _transcript_print()

    # Show output files if any exist
    show_output_files(session)

    _tui.draw(session, "idle")


# ═══════════════════════════════════════════════════════════════
# Command Handlers
# ═══════════════════════════════════════════════════════════════
def handle_init(session: Session, args: list):
    """Handle /init command: initialize a run with paper title and file."""
    if len(args) < 2:
        _transcript_print(f"{BRED}[!] Usage: /init <paper_title> <original_file_path>{RESET}")
        _tui.draw(session, "idle")
        return

    title = args[0]
    file_path = " ".join(args[1:])

    if not os.path.exists(file_path):
        _transcript_print(f"{BRED}[!] File not found: {file_path}{RESET}")
        _tui.draw(session, "idle")
        return

    with open(file_path, "r", encoding="utf-8") as f:
        original_text = f.read()

    # ── HITL: Confirm before init_run ──
    _transcript_print(f"{YELLOW}{BOLD}⚠ CONFIRM │ init_run │ y/n{RESET}")
    _transcript_print(f"{BWHITE}  Title :{RESET} {BGREEN}{title}{RESET}")
    _transcript_print(f"{BWHITE}  File  :{RESET} {WHITE}{file_path}{RESET}")
    _transcript_print(f"{BWHITE}  Chars :{RESET} {WHITE}{len(original_text):,}{RESET}")

    _tui.draw(session, "confirming init")

    try:
        w, h = _term_size()
        input_row = h - 1
        _tui._move_to(input_row, 1)
        _tui._clear_line()
        _tui._write(f"{YELLOW}{BOLD}? Proceed? (y/n){RESET} ")
        sys.stdout.flush()
        answer = input("").strip().lower()
    except (EOFError, KeyboardInterrupt):
        answer = "n"

    if answer not in ("y", "yes", ""):
        _transcript_print(f"{YELLOW}[!] Cancelled{RESET}")
        _tui.draw(session, "idle")
        return

    from agent.graph import init_run, set_current_run_id
    set_current_run_id(session.run_id)
    init_run(session.run_id, original_text, paper_title=title)

    _transcript_print(f"{BGREEN}[✓] Initialized run '{session.run_id}' with paper '{title}'{RESET}")
    _transcript_print(f"{DIM}Original text: {len(original_text):,} chars{RESET}")
    _tui.draw(session, "idle")


def handle_command(session: Session, line: str) -> bool:
    """Handle slash commands. Returns True if should exit."""
    parts = line.strip().split()
    cmd = parts[0].lower()
    args = parts[1:] if len(parts) > 1 else []

    if cmd in ("/quit", "/exit", "/q"):
        _transcript_print(f"{DIM}Goodbye, Neo.{RESET}")
        _transcript_print(f"{GREEN}{DIM}The Matrix has you...{RESET}")
        _tui.draw(session, "exiting")
        return True

    elif cmd == "/help":
        show_help()
        _tui.draw(session, "idle")

    elif cmd == "/new":
        new_id = args[0] if args else ""
        session.reset(new_id)
        _tui._transcript = []
        _transcript_print(f"{BGREEN}[*] New session: {session.run_id}{RESET}")
        show_welcome()
        _tui.draw(session, "ready")

    elif cmd == "/status":
        for line in session.status_info():
            _transcript_print(line)
        _tui.draw(session, "idle")

    elif cmd == "/history":
        show_history(session)
        _tui.draw(session, "idle")

    elif cmd == "/init":
        handle_init(session, args)

    else:
        _transcript_print(f"{YELLOW}[?] Unknown command: {cmd}. Type /help for commands.{RESET}")
        _tui.draw(session, "idle")

    return False


# ═══════════════════════════════════════════════════════════════
# Main Loop
# ═══════════════════════════════════════════════════════════════
async def main_async(run_id: str = ""):
    """Main async loop with full-screen TUI."""
    session = Session(run_id)

    # Enter alternate screen
    _tui.enter_alt_screen()

    # Initial content
    show_welcome()
    _tui.draw(session, "ready")

    try:
        while True:
            line = _get_input_in_alt(session, "▸")
            if line is None:
                _transcript_print(f"{DIM}Goodbye, Neo.{RESET}")
                _tui.draw(session, "exiting")
                time.sleep(0.5)
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
                _transcript_print(f"{BRED}[!] Turn error: {type(e).__name__}: {e}{RESET}")
                if os.getenv("DEBUG"):
                    traceback.print_exc()
                _tui.draw(session, "error")

    finally:
        # Leave alternate screen on exit
        _tui.leave_alt_screen()
        sys.stdout.write(CURSOR_SHOW)
        sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser(description="Paper Rewriter Terminal UI (Matrix Mode)")
    parser.add_argument("--run-id", default="", help="Run ID for the session")
    parser.add_argument("--debug", action="store_true", help="Enable debug output")
    args = parser.parse_args()

    if args.debug:
        os.environ["DEBUG"] = "1"

    try:
        asyncio.run(main_async(args.run_id))
    except KeyboardInterrupt:
        _tui.leave_alt_screen()
        sys.stdout.write(CURSOR_SHOW + "\n")
        sys.stdout.flush()

if __name__ == "__main__":
    main()
