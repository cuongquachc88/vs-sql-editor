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

export const window = {
  showInformationMessage: async () => undefined,
  showErrorMessage: async () => undefined,
};
export const commands = { registerCommand: () => ({ dispose() {} }) };
