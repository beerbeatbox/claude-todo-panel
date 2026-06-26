import * as vscode from 'vscode';

type TodoStatus = 'pending' | 'in_progress' | 'completed';

interface Todo {
  content: string;
  status: TodoStatus;
  activeForm?: string;
}

interface TodoFile {
  sessionId?: string;
  cwd?: string;
  updatedAt?: string;
  todos?: Todo[];
}

/** Resolve the configured todo file across all open workspace folders. */
function todoUris(): vscode.Uri[] {
  const rel = vscode.workspace
    .getConfiguration('claudeTodo')
    .get<string>('file', '.claude/todos-current.json');
  return (vscode.workspace.workspaceFolders ?? []).map((f) =>
    vscode.Uri.joinPath(f.uri, ...rel.split('/'))
  );
}

async function readTodos(): Promise<{ uri: vscode.Uri; data: TodoFile } | undefined> {
  for (const uri of todoUris()) {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const data = JSON.parse(Buffer.from(bytes).toString('utf8')) as TodoFile;
      return { uri, data };
    } catch {
      // file missing or invalid in this folder — try the next one
    }
  }
  return undefined;
}

class TodoItem extends vscode.TreeItem {
  constructor(todo: Todo) {
    const label = todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content;
    super(label, vscode.TreeItemCollapsibleState.None);

    switch (todo.status) {
      case 'completed':
        this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
        this.description = 'done';
        break;
      case 'in_progress':
        this.iconPath = new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.yellow'));
        this.description = 'in progress';
        break;
      default:
        this.iconPath = new vscode.ThemeIcon('circle-large-outline');
        this.description = '';
    }
    this.tooltip = todo.content;
  }
}

class HeaderItem extends vscode.TreeItem {
  constructor(data: TodoFile) {
    const todos = data.todos ?? [];
    const done = todos.filter((t) => t.status === 'completed').length;
    super(`${done}/${todos.length} done`, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('checklist');
    if (data.updatedAt) {
      const when = new Date(data.updatedAt);
      this.description = isNaN(when.getTime()) ? data.updatedAt : when.toLocaleTimeString();
    }
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

  async getChildren(): Promise<vscode.TreeItem[]> {
    const found = await readTodos();
    if (!found || !found.data.todos?.length) {
      const empty = new vscode.TreeItem('No todos yet — Claude will fill this in.');
      empty.iconPath = new vscode.ThemeIcon('info');
      return [empty];
    }
    return [new HeaderItem(found.data), ...found.data.todos.map((t) => new TodoItem(t))];
  }
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new TodoProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('claudeTodo.list', provider)
  );

  // Watch every candidate file so the panel refreshes the moment the hook writes.
  const rel = vscode.workspace
    .getConfiguration('claudeTodo')
    .get<string>('file', '.claude/todos-current.json');
  const watcher = vscode.workspace.createFileSystemWatcher(`**/${rel}`);
  watcher.onDidChange(() => provider.refresh());
  watcher.onDidCreate(() => provider.refresh());
  watcher.onDidDelete(() => provider.refresh());
  context.subscriptions.push(watcher);

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeTodo.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('claudeTodo.openFile', async () => {
      const found = await readTodos();
      if (found) {
        await vscode.window.showTextDocument(found.uri);
      } else {
        vscode.window.showInformationMessage('No Claude todo file found in the open workspace yet.');
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeTodo.file')) provider.refresh();
    })
  );
}

export function deactivate() {}
