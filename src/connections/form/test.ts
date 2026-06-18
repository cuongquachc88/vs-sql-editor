import { createDriver as defaultCreateDriver } from "../../drivers/registry";
import { DriverError, type DatabaseDriver, type Session } from "../../drivers/types";
import type { FormProfile } from "./protocol";

export type TestResult = { ok: true } | { ok: false; error: string };

// Attempts to open a connection with the given profile + secret, then disposes it.
// Used by the Test Connection button in ConnectionFormPanel.
export async function runConnectionTest(
  profile: FormProfile,
  secret: string | undefined,
  createDriver: (engine: FormProfile["engine"]) => DatabaseDriver = defaultCreateDriver,
): Promise<TestResult> {
  let driver: DatabaseDriver;
  try {
    driver = createDriver(profile.engine);
  } catch (err) {
    return { ok: false, error: DriverError.from(err).message };
  }

  let session: Session | undefined;
  try {
    session = await driver.connect({ ...profile, id: "__test__" }, secret);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: DriverError.from(err).message };
  } finally {
    if (session) {
      try {
        await driver.dispose(session);
      } catch {
        // disposal failure shouldn't mask the test result
      }
    }
  }
}
