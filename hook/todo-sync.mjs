#!/usr/bin/env node
// Claude Code PostToolUse hook for TodoWrite.
// Reads the hook payload on stdin and mirrors the current todo list to
//   <cwd>/.claude/todos/<session>.json (one file per chat, grouped by the panel)
//
// Wire it up in .claude/settings.json (see README). It never blocks the tool:
// any error is swallowed and exit 0 is returned.

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
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

// The chat tab title Claude Code shows is stored as {"type":"ai-title","aiTitle":...}
// lines in the session transcript. Pull the most recent one so each session gets
// the same human-readable name as its tab.
function readSessionTitle(transcriptPath) {
  if (!transcriptPath) return undefined;
  try {
    const lines = readFileSync(transcriptPath, 'utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line.includes('"ai-title"')) continue;
      const entry = JSON.parse(line);
      if (entry.type === 'ai-title' && entry.aiTitle) return entry.aiTitle;
    }
  } catch {
    // transcript missing/locked — fall back to no title
  }
  return undefined;
}

try {
  const raw = await readStdin();
  const payload = JSON.parse(raw || '{}');

  if (payload.tool_name !== 'TodoWrite') process.exit(0);

  const todos = payload.tool_input?.todos ?? [];
  const cwd = payload.cwd || process.cwd();
  const sessionId = payload.session_id || 'unknown';
  const title = readSessionTitle(payload.transcript_path);

  const record = {
    sessionId,
    title,
    cwd,
    updatedAt: new Date().toISOString(),
    todos,
  };

  const archiveDir = join(cwd, '.claude', 'todos');
  mkdirSync(archiveDir, { recursive: true });

  // One file per session; the panel reads the whole folder and groups by chat.
  writeFileSync(join(archiveDir, `${sessionId}.json`), JSON.stringify(record, null, 2));
} catch {
  // Never break the tool because of the mirror.
}

process.exit(0);
