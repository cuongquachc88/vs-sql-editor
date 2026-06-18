import { createDriver } from "../drivers/registry";
import type { ConnectionProfile, DatabaseDriver, Session } from "../drivers/types";

interface Live {
  driver: DatabaseDriver;
  session: Session;
}

export class ConnectionManager {
  private readonly live = new Map<string, Live>();

  constructor(
    private readonly driverFor: (engine: ConnectionProfile["engine"]) => DatabaseDriver = createDriver,
    private readonly secretFor: (id: string) => Promise<string | undefined> = async () => undefined,
    private readonly profileFor: (id: string) => ConnectionProfile | undefined = () => undefined,
  ) {}

  async get(profileId: string): Promise<Session> {
    const existing = this.live.get(profileId);
    if (existing) return existing.session;

    const profile = this.profileFor(profileId);
    if (!profile) throw new Error(`Unknown connection: ${profileId}`);

    const driver = this.driverFor(profile.engine);
    const secret = await this.secretFor(profileId);
    const session = await driver.connect(profile, secret);
    this.live.set(profileId, { driver, session });
    return session;
  }

  driverOf(profileId: string): DatabaseDriver | undefined {
    return this.live.get(profileId)?.driver;
  }

  hasSession(profileId: string): boolean {
    return this.live.has(profileId);
  }

  liveProfileIds(): string[] {
    return [...this.live.keys()];
  }

  async disconnect(profileId: string): Promise<void> {
    const l = this.live.get(profileId);
    if (!l) return;
    this.live.delete(profileId);
    await l.driver.dispose(l.session);
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.live.keys()].map((id) => this.disconnect(id)));
  }
}
