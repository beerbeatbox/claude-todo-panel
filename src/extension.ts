import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

type TodoStatus = 'pending' | 'in_progress' | 'completed';

interface Todo {
  content: string;
  status: TodoStatus;
  activeForm?: string;
}

interface TodoFile {
  sessionId?: string;
  title?: string;
  cwd?: string;
  updatedAt?: string;
  todos?: Todo[];
}

interface Session {
  uri: vscode.Uri;
  data: TodoFile;
}

function dirRel(): string {
  return vscode.workspace.getConfiguration('claudeTodo').get<string>('dir', '.claude/todos');
}

function maxSessions(): number {
  return vscode.workspace.getConfiguration('claudeTodo').get<number>('maxSessions', 20);
}

/** Read every per-session archive across all workspace folders, newest first. */
async function readSessions(): Promise<Session[]> {
  const rel = dirRel();
  const sessions: Session[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const dir = vscode.Uri.joinPath(folder.uri, ...rel.split('/'));
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dir);
    } catch {
      continue; // no todos dir in this folder
    }
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File || !name.endsWith('.json')) continue;
      const uri = vscode.Uri.joinPath(dir, name);
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const data = JSON.parse(Buffer.from(bytes).toString('utf8')) as TodoFile;
        sessions.push({ uri, data });
      } catch {
        // skip unreadable/half-written file
      }
    }
  }
  sessions.sort((a, b) => (b.data.updatedAt ?? '').localeCompare(a.data.updatedAt ?? ''));
  return sessions.slice(0, maxSessions());
}

// A chat is "stale" once its file hasn't been touched for a while — i.e. Claude
// has stopped working on it. We use this to stop animating a lingering
// in_progress item so it doesn't spin forever after the work is actually done.
const STALE_MS = 120_000;
function isStale(iso?: string): boolean {
  if (!iso) return true;
  const t = new Date(iso).getTime();
  return isNaN(t) || Date.now() - t > STALE_MS;
}

function statusIcon(status: TodoStatus, stale: boolean): vscode.ThemeIcon {
  const yellow = new vscode.ThemeColor('charts.yellow');
  switch (status) {
    case 'completed':
      return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
    case 'in_progress':
      // Spin only while the chat is live; once idle, show a static paused icon.
      return stale
        ? new vscode.ThemeIcon('debug-pause', yellow)
        : new vscode.ThemeIcon('sync~spin', yellow);
    default:
      return new vscode.ThemeIcon('circle-large-outline');
  }
}

function relTime(iso?: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return iso;
  const secs = Math.round((Date.now() - t) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

class SessionItem extends vscode.TreeItem {
  constructor(readonly session: Session, expanded: boolean) {
    const todos = session.data.todos ?? [];
    const done = todos.filter((t) => t.status === 'completed').length;
    const allDone = todos.length > 0 && done === todos.length;
    const short = (session.data.sessionId ?? '').slice(0, 6);
    const label = session.data.title?.trim() || (short ? `#${short}` : 'Untitled chat');

    super(
      label,
      todos.length
        ? expanded
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    this.description = `${done}/${todos.length} · ${relTime(session.data.updatedAt)}`;
    this.iconPath = allDone
      ? new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('charts.green'))
      : new vscode.ThemeIcon('comment-discussion');
    this.tooltip = [session.data.title, session.data.sessionId, session.uri.fsPath]
      .filter(Boolean)
      .join('\n');
    this.contextValue = 'session';
  }
}

class TodoItem extends vscode.TreeItem {
  constructor(todo: Todo, stale: boolean) {
    const label =
      todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content;
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = statusIcon(todo.status, stale);
    this.description =
      todo.status === 'completed'
        ? 'done'
        : todo.status === 'in_progress'
          ? stale
            ? 'paused'
            : 'in progress'
          : '';
    this.tooltip = todo.content;
  }
}

class TodoProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  refresh(): void {
    this._onDidChange.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element instanceof SessionItem) {
      const stale = isStale(element.session.data.updatedAt);
      return (element.session.data.todos ?? []).map((t) => new TodoItem(t, stale));
    }
    const sessions = await readSessions();
    if (!sessions.length) {
      const empty = new vscode.TreeItem('No todos yet — Claude will fill this in.');
      empty.iconPath = new vscode.ThemeIcon('info');
      return [empty];
    }
    // Newest chat expanded, the rest collapsed to keep the panel tidy.
    return sessions.map((s, i) => new SessionItem(s, i === 0));
  }
}

// --- Hook wiring -----------------------------------------------------------
// The panel only shows data once the Claude Code PostToolUse hook is mirroring
// TodoWrite to .claude/todos/. Rather than make every user hand-edit settings
// and hard-code a path, these commands write ~/.claude/settings.json for them,
// pointing at the hook script bundled inside this extension.

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

/** Absolute `node "<path>"` command for the hook shipped with the extension. */
function hookCommand(context: vscode.ExtensionContext): string {
  const script = path.join(context.extensionPath, 'hook', 'todo-sync.mjs');
  return `node ${JSON.stringify(script)}`;
}

/** Identify our entries by the script filename, so we can update/remove cleanly. */
function isOurs(h: any): boolean {
  return typeof h?.command === 'string' && h.command.includes('todo-sync.mjs');
}

/** Read ~/.claude/settings.json, or `undefined` if it exists but is unparseable. */
function readSettings(): Record<string, any> | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
  } catch {
    return {}; // missing file — start fresh
  }
  try {
    return JSON.parse(raw);
  } catch {
    return undefined; // exists but malformed — refuse to clobber
  }
}

async function installHook(context: vscode.ExtensionContext): Promise<void> {
  const settings = readSettings();
  if (!settings) {
    const open = 'Open settings.json';
    const pick = await vscode.window.showErrorMessage(
      `Could not parse ${SETTINGS_PATH}. Fix the JSON and try again.`,
      open
    );
    if (pick === open) {
      await vscode.window.showTextDocument(vscode.Uri.file(SETTINGS_PATH));
    }
    return;
  }

  const command = hookCommand(context);
  settings.hooks ??= {};
  settings.hooks.PostToolUse ??= [];
  const list: any[] = settings.hooks.PostToolUse;

  let group = list.find((g) => g && g.matcher === 'TodoWrite');
  if (!group) {
    group = { matcher: 'TodoWrite', hooks: [] };
    list.push(group);
  }
  group.hooks ??= [];
  // Drop any prior todo-sync entry so a moved/renamed extension path updates cleanly.
  group.hooks = group.hooks.filter((h: any) => !isOurs(h));
  group.hooks.push({ type: 'command', command, async: true });

  try {
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to write ${SETTINGS_PATH}: ${err}`);
    return;
  }

  vscode.window.showInformationMessage(
    'Claude Todo hook installed. Restart any running Claude Code sessions for it to take effect.'
  );
}

async function removeHook(): Promise<void> {
  const settings = readSettings();
  if (!settings) {
    vscode.window.showErrorMessage(`Could not parse ${SETTINGS_PATH}.`);
    return;
  }
  const list: any[] = settings.hooks?.PostToolUse;
  if (!Array.isArray(list)) {
    vscode.window.showInformationMessage('No Claude Todo hook was installed.');
    return;
  }

  let removed = 0;
  for (const group of list) {
    if (!group?.hooks) continue;
    const before = group.hooks.length;
    group.hooks = group.hooks.filter((h: any) => !isOurs(h));
    removed += before - group.hooks.length;
  }
  // Drop now-empty matcher groups we may have emptied.
  settings.hooks.PostToolUse = list.filter((g) => !Array.isArray(g?.hooks) || g.hooks.length);

  if (!removed) {
    vscode.window.showInformationMessage('No Claude Todo hook was installed.');
    return;
  }
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to write ${SETTINGS_PATH}: ${err}`);
    return;
  }
  vscode.window.showInformationMessage('Claude Todo hook removed.');
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new TodoProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('claudeTodo.list', provider)
  );

  // Watch the whole archive dir so adding/updating/removing any session refreshes.
  const watcher = vscode.workspace.createFileSystemWatcher(`**/${dirRel()}/*.json`);
  watcher.onDidChange(() => provider.refresh());
  watcher.onDidCreate(() => provider.refresh());
  watcher.onDidDelete(() => provider.refresh());
  context.subscriptions.push(watcher);

  // Refresh relative timestamps periodically.
  const ticker = setInterval(() => provider.refresh(), 60_000);
  context.subscriptions.push({ dispose: () => clearInterval(ticker) });

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeTodo.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('claudeTodo.installHook', () => installHook(context)),
    vscode.commands.registerCommand('claudeTodo.removeHook', () => removeHook()),
    vscode.commands.registerCommand('claudeTodo.openFile', async (item?: SessionItem) => {
      const uri = item?.session?.uri ?? (await readSessions())[0]?.uri;
      if (uri) {
        await vscode.window.showTextDocument(uri);
      } else {
        vscode.window.showInformationMessage('No Claude todo file found yet.');
      }
    }),
    // Delete one chat's archive from the panel (context menu).
    vscode.commands.registerCommand('claudeTodo.removeSession', async (item?: SessionItem) => {
      if (!item?.session) return;
      await vscode.workspace.fs.delete(item.session.uri);
      provider.refresh();
    }),
    // Tidy: drop every chat whose todos are all completed.
    vscode.commands.registerCommand('claudeTodo.tidy', async () => {
      const sessions = await readSessions();
      const finished = sessions.filter((s) => {
        const t = s.data.todos ?? [];
        return t.length > 0 && t.every((x) => x.status === 'completed');
      });
      if (!finished.length) {
        vscode.window.showInformationMessage('No finished chats to clear.');
        return;
      }
      await Promise.all(finished.map((s) => vscode.workspace.fs.delete(s.uri)));
      provider.refresh();
      vscode.window.showInformationMessage(`Cleared ${finished.length} finished chat(s).`);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeTodo')) provider.refresh();
    })
  );
}

export function deactivate() {}
