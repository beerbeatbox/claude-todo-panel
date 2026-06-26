# Claude Todo Panel

A pinned VS Code sidebar that shows **Claude Code's live todo list**, so you
never have to scroll the chat to find it. A Claude Code hook mirrors every
`TodoWrite` to a JSON file; the extension watches that file and refreshes the
panel automatically.

```
[any project]                          claude-todo-panel (this extension)
 .claude/settings.json ─┐  PostToolUse
   hook: todo-sync.mjs  │  on TodoWrite
                        ▼  writes
 .claude/todos-current.json ◄────────── FileSystemWatcher → sidebar TreeView
```

The extension is project-agnostic — it reads `.claude/todos-current.json` from
whichever workspace folder is open, so it works for every project, not just one.

## 1. Install the extension (local, no marketplace)

```bash
npm install
npm run build          # bundles src → dist/extension.js
npm run package        # produces claude-todo-panel-0.0.1.vsix
code --install-extension claude-todo-panel-0.0.1.vsix
```

Or just press **F5** in this repo to launch an Extension Development Host and try
it without installing.

After installing, look for the **checklist icon** in the Activity Bar.

## 2. Wire up the hook

The panel shows nothing until the hook starts writing the file. Add this to your
Claude Code settings — `~/.claude/settings.json` for *all* projects, or a
project's `.claude/settings.json` for just one:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "TodoWrite",
        "hooks": [
          {
            "type": "command",
            "command": "node /Users/woraprotdechrut/Projects/claude-todo-panel/hook/todo-sync.mjs"
          }
        ]
      }
    ]
  }
}
```

The hook writes two files into the project's `.claude/`:

- `todos-current.json` — the latest list (what the panel reads)
- `todos/<session_id>.json` — a per-chat archive, so a new chat never wipes an old list

It never blocks the tool: on any error it silently exits 0.

## 3. File format (the contract)

```json
{
  "sessionId": "abc123",
  "cwd": "/path/to/project",
  "updatedAt": "2026-06-27T10:00:00.000Z",
  "todos": [
    { "content": "Build the scaffold", "status": "completed", "activeForm": "Building the scaffold" },
    { "content": "Wire the hook",       "status": "in_progress", "activeForm": "Wiring the hook" },
    { "content": "Polish the UI",        "status": "pending",     "activeForm": "Polishing the UI" }
  ]
}
```

`status` is one of `pending` | `in_progress` | `completed`.

## Settings

- `claudeTodo.file` (default `.claude/todos-current.json`) — path, relative to each
  workspace folder, of the file the panel reads.

## Roadmap

- Swap the TreeView for a Webview for a richer card layout
- Click a todo to jump to the relevant file
- Progress bar in the view title
