import * as vscode from "vscode";
import type { SchemaCache } from "../connections/schema-cache";
import type { EngineId, SchemaModel } from "../drivers/types";

export type TreeNode =
  | { kind: "connection"; profileId: string; label: string; engine: EngineId }
  | { kind: "database"; profileId: string; engine: EngineId; database: string }
  | { kind: "schema"; profileId: string; engine: EngineId; database: string; schema: string }
  | {
      kind: "table";
      profileId: string;
      engine: EngineId;
      database: string;
      schema: string;
      table: string;
      isView: boolean;
    }
  | { kind: "column"; label: string; columnType: string };

export interface ConnectionSummary {
  id: string;
  name: string;
  engine: EngineId;
}

// Renders connections -> database -> schema -> table -> columns. Schema models are
// introspected lazily on first expand of a connection and cached until refreshed.
export class SchemaExplorerProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChange = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(
    private readonly listConnections: () => ConnectionSummary[],
    private readonly schemaCache: SchemaCache,
  ) {}

  refresh(): void {
    this.schemaCache.invalidate();
    this._onDidChange.fire(undefined);
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    switch (node.kind) {
      case "connection": {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = new vscode.ThemeIcon("server-environment");
        item.description = node.engine;
        item.contextValue = "vsSqlEditor.connection";
        return item;
      }
      case "database": {
        const item = new vscode.TreeItem(node.database, vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = new vscode.ThemeIcon("database");
        item.contextValue = "vsSqlEditor.database";
        return item;
      }
      case "schema": {
        const item = new vscode.TreeItem(node.schema, vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = new vscode.ThemeIcon("symbol-namespace");
        item.contextValue = "vsSqlEditor.schema";
        return item;
      }
      case "table": {
        const item = new vscode.TreeItem(node.table, vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = new vscode.ThemeIcon(node.isView ? "eye" : "table");
        item.contextValue = node.isView ? "vsSqlEditor.view" : "vsSqlEditor.table";
        item.command = {
          command: "vsSqlEditor.previewTable",
          title: "Preview Data",
          arguments: [node],
        };
        return item;
      }
      case "column": {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("symbol-field");
        item.description = node.columnType;
        item.contextValue = "vsSqlEditor.column";
        return item;
      }
    }
  }

  async getChildren(node?: TreeNode): Promise<TreeNode[]> {
    if (!node) {
      return this.listConnections().map((c) => ({
        kind: "connection",
        profileId: c.id,
        label: c.name,
        engine: c.engine,
      }));
    }

    if (node.kind === "connection") {
      const model = await this.getModel(node.profileId);
      if (!model) return [];
      return model.databases.map((d) => ({
        kind: "database",
        profileId: node.profileId,
        engine: node.engine,
        database: d.name,
      }));
    }

    if (node.kind === "database") {
      const model = this.schemaCache.peek(node.profileId);
      const db = model?.databases.find((d) => d.name === node.database);
      return (db?.schemas ?? []).map((s) => ({
        kind: "schema",
        profileId: node.profileId,
        engine: node.engine,
        database: node.database,
        schema: s.name,
      }));
    }

    if (node.kind === "schema") {
      const model = this.schemaCache.peek(node.profileId);
      const schema = model?.databases
        .find((d) => d.name === node.database)
        ?.schemas.find((s) => s.name === node.schema);
      return (schema?.tables ?? []).map((t) => ({
        kind: "table",
        profileId: node.profileId,
        engine: node.engine,
        database: node.database,
        schema: node.schema,
        table: t.name,
        isView: t.isView,
      }));
    }

    if (node.kind === "table") {
      const model = this.schemaCache.peek(node.profileId);
      const table = model?.databases
        .find((d) => d.name === node.database)
        ?.schemas.find((s) => s.name === node.schema)
        ?.tables.find((t) => t.name === node.table);
      return (table?.columns ?? []).map((c) => ({
        kind: "column",
        label: c.name,
        columnType: c.type,
      }));
    }

    return [];
  }

  private async getModel(profileId: string): Promise<SchemaModel | undefined> {
    try {
      return await this.schemaCache.get(profileId);
    } catch (err) {
      void vscode.window.showErrorMessage(`Failed to load schema: ${(err as Error).message}`);
      return undefined;
    }
  }
}

// Build a qualified, quoted table reference for a SELECT preview, per engine.
export function qualifyTable(
  engine: EngineId,
  schema: string,
  table: string,
): string {
  switch (engine) {
    case "postgres":
    case "pglite":
      return `"${schema}"."${table}"`;
    case "mysql":
      return `\`${schema}\`.\`${table}\``;
    case "clickhouse":
      return `"${schema}"."${table}"`;
    case "sqlite":
      return `"${table}"`;
  }
}
