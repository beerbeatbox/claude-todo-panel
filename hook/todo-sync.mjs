#!/usr/bin/env node
// Claude Code PostToolUse hook for TodoWrite.
// Reads the hook payload on stdin and mirrors the current todo list to
//   <cwd>/.claude/todos-current.json   (latest list — open this / let the panel read it)
//   <cwd>/.claude/todos/<session>.json (per-session archive, never overwritten by other chats)
//
// Wire it up in .claude/settings.json (see README). It never blocks the tool:
// any error is swallowed and exit 0 is returned.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => resolve(buf));
    // If nothing is piped, don't hang forever.
    setTimeout(() => resolve(buf), 2000);
  });
}

try {
  const raw = await readStdin();
  const payload = JSON.parse(raw || '{}');

  if (payload.tool_name !== 'TodoWrite') process.exit(0);

  const todos = payload.tool_input?.todos ?? [];
  const cwd = payload.cwd || process.cwd();
  const sessionId = payload.session_id || 'unknown';

  const record = {
    sessionId,
    cwd,
    updatedAt: new Date().toISOString(),
    todos,
  };

  const claudeDir = join(cwd, '.claude');
  const archiveDir = join(claudeDir, 'todos');
  mkdirSync(archiveDir, { recursive: true });

  const json = JSON.stringify(record, null, 2);
  writeFileSync(join(claudeDir, 'todos-current.json'), json);
  writeFileSync(join(archiveDir, `${sessionId}.json`), json);
} catch {
  // Never break the tool because of the mirror.
}

process.exit(0);
