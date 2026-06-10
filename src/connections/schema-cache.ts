import type { SchemaModel } from "../drivers/types";

// Caches introspected schema models per connection, shared by the schema explorer
// (lazy expand) and the autocomplete provider (fast synchronous peek).
export class SchemaCache {
  private readonly cache = new Map<string, SchemaModel>();

  constructor(private readonly introspectFn: (profileId: string) => Promise<SchemaModel>) {}

  // Synchronous, non-throwing: returns a cached model or undefined.
  peek(profileId: string): SchemaModel | undefined {
    return this.cache.get(profileId);
  }

  // Returns the cached model or introspects and caches it.
  async get(profileId: string): Promise<SchemaModel> {
    const cached = this.cache.get(profileId);
    if (cached) return cached;
    const model = await this.introspectFn(profileId);
    this.cache.set(profileId, model);
    return model;
  }

  invalidate(profileId?: string): void {
    if (profileId) this.cache.delete(profileId);
    else this.cache.clear();
  }
}
