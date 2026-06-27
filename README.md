# Claude Todo Panel

A pinned VS Code sidebar that shows **Claude Code's live todo list**, so you
never have to scroll the chat to find it. A Claude Code hook mirrors every
`TodoWrite` to one JSON file per chat; the extension watches the folder, groups
the todos by chat, and refreshes automatically.

```
[any project]                          claude-todo-panel (this extension)
 .claude/settings.json ─┐  PostToolUse
   hook: todo-sync.mjs  │  on TodoWrite
                        ▼  writes one file per session
 .claude/todos/<session>.json ◄──────── FileSystemWatcher → sidebar TreeView
                                          (one collapsible group per chat)
```

The extension is project-agnostic — it reads `.claude/todos/` from whichever
workspace folder is open, so it works for every project, not just one. Because
every chat gets its own file (named by `session_id`), several chats running in
parallel in the same project never clobber each other — they show up as separate
groups, each labelled with the chat's title.

## 1. Install the extension

**From a release (recommended):** download the latest
`claude-todo-panel-<version>.vsix` from the
[Releases page](https://github.com/beerbeatbox/claude-todo-panel/releases), then:

```bash
code --install-extension claude-todo-panel-<version>.vsix
```

Or in VS Code: **Extensions** view → **⋯** menu → **Install from VSIX…**

**From source:** clone this repo and run:

```bash
npm install
npm run build          # bundles src → dist/extension.js
npm run package        # produces claude-todo-panel-<version>.vsix
code --install-extension claude-todo-panel-<version>.vsix
```

Or just press **F5** in this repo to launch an Extension Development Host and try
it without installing.

After installing, look for the **checklist icon** in the Activity Bar.

## 2. Wire up the hook (one click)

The panel shows nothing until the hook starts writing files. Open the **Claude
Todos** panel, click the **⋯** menu in its title bar, and choose **Install Sync
Hook** (or run **Claude Todos: Install Sync Hook** from the Command Palette).

That writes `~/.claude/settings.json` for you, pointing a `PostToolUse` →
`TodoWrite` hook at the `todo-sync.mjs` script bundled inside the extension — no
hand-editing and no hard-coded paths. Restart any running Claude Code sessions
for it to take effect. **Remove Sync Hook** undoes it.

<details>
<summary>What it writes (and how to do it by hand)</summary>

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "TodoWrite",
        "hooks": [
          {
            "type": "command",
            "command": "node \"<extension>/hook/todo-sync.mjs\"",
            "async": true
          }
        ]
      }
    ]
  }
}
```

Use `~/.claude/settings.json` for *all* projects, or a project's
`.claude/settings.json` for just one.
</details>

The hook writes one file per chat: `.claude/todos/<session_id>.json`. It pulls
the chat's title from the session transcript (the `ai-title` entry, same name as
the tab) so the panel can label each group. It never blocks the tool: on any
error it silently exits 0.

## 3. File format (the contract)

```json
{
  "sessionId": "abc123",
  "title": "Make the todo list stick to the chat",
  "cwd": "/path/to/project",
  "updatedAt": "2026-06-27T10:00:00.000Z",
  "todos": [
    { "content": "Build the scaffold", "status": "completed", "activeForm": "Building the scaffold" },
    { "content": "Wire the hook",       "status": "in_progress", "activeForm": "Wiring the hook" },
    { "content": "Polish the UI",        "status": "pending",     "activeForm": "Polishing the UI" }
  ]
}
```

`status` is one of `pending` | `in_progress` | `completed`. `title` is optional
(falls back to a short session id).

## Panel actions

- **Refresh** / **Clear Finished Chats** (title bar) — the latter drops every
  chat whose todos are all completed.
- **Open file** / **Remove** (hover a chat) — open that session's JSON, or delete it.
- Newest chat is expanded; the rest collapse to stay tidy.

## Settings

- `claudeTodo.dir` (default `.claude/todos`) — folder, relative to each workspace
  folder, holding the per-session files.
- `claudeTodo.maxSessions` (default `20`) — how many recent chats to show.

## Roadmap

- Swap the TreeView for a Webview for a richer card layout
- Click a todo to jump to the relevant file
- Progress bar in the view title
