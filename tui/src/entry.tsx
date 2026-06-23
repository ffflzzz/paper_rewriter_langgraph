#!/usr/bin/env node
/**
 * Paper Rewriter TUI — Entry point.
 *
 * Connects to the Python AG-UI backend at localhost:8765.
 * Uses Ink (React-based terminal UI framework).
 */

import React from 'react'
import { render } from 'ink'
import { App } from './App.js'

if (!process.stdin.isTTY) {
  console.error('Error: Paper Rewriter TUI requires a TTY terminal.')
  console.error('Please run this in an interactive terminal (not a pipe or redirect).')
  process.exit(1)
}

// Clean the terminal before rendering
process.stdout.write('\x1b[2J\x1b[H\x1b[3J')

const { waitUntilExit } = render(React.createElement(App), {
  exitOnCtrlC: false,
})

waitUntilExit().then(() => {
  // Ensure alternate screen is released
  process.stdout.write('\x1b[?25h')
  process.stdout.write('\x1b[?1049l')
  process.exit(0)
})
