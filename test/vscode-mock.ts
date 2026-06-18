// Minimal in-memory stand-ins for the VS Code APIs used in unit tests.
export class Memento {
  private data = new Map<string, unknown>();
  get<T>(key: string, def?: T): T | undefined {
    return (this.data.has(key) ? this.data.get(key) : def) as T;
  }
  async update(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }
  keys(): readonly string[] {
    return [...this.data.keys()];
  }
}

export class SecretStorage {
  private data = new Map<string, string>();
  async get(key: string): Promise<string | undefined> {
    return this.data.get(key);
  }
  async store(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
}

export class EventEmitter<T> {
  private listeners: ((e: T) => void)[] = [];
  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => undefined };
  };
  fire(data: T): void {
    for (const l of this.listeners) l(data);
  }
  dispose(): void {}
}

export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };

export class TreeItem {
  iconPath?: unknown;
  description?: string;
  contextValue?: string;
  command?: unknown;
  constructor(
    public label: string,
    public collapsibleState?: number,
  ) {}
}

export class ThemeIcon {
  constructor(public id: string) {}
}

// Minimal Notebook API stubs — just enough for the serializer unit tests.
export const NotebookCellKind = { Markup: 1, Code: 2 } as const;

export class NotebookCellData {
  outputs?: unknown[];
  metadata?: unknown;
  executionSummary?: unknown;
  constructor(
    public kind: number,
    public value: string,
    public languageId: string,
  ) {}
}

export class NotebookData {
  metadata?: unknown;
  constructor(public cells: NotebookCellData[]) {}
}

export const window = {
  showInformationMessage: async () => undefined,
  showErrorMessage: async () => undefined,
};
export const commands = { registerCommand: () => ({ dispose() {} }) };
