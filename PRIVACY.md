# Privacy Policy — VS SQL Editor

_Last updated: 2026-06-10_

VS SQL Editor ("the extension") is a VS Code extension for connecting to and querying
SQL databases. This policy explains what data the extension handles.

## Summary

**The extension does not collect, transmit, or share any personal data. It has no
telemetry and no analytics.** Everything stays on your machine.

## What data the extension stores, and where

| Data | Where it is stored | Leaves your machine? |
|------|--------------------|----------------------|
| Connection profiles (name, engine, host, port, database, user, file path) | VS Code global state, on your machine | No |
| Database passwords | VS Code **SecretStorage** (OS keychain — Windows Credential Manager / macOS Keychain / libsecret) | No |
| SQL you write and query results | In memory during a session; results are only written to disk when **you** click Export | No (except where you choose to export) |

## Network connections

The only network connections the extension makes are the **database connections you
explicitly configure** (e.g. to your PostgreSQL, MySQL, or ClickHouse server). Your SQL
and credentials are sent only to those servers, exactly as a normal database client would.
SQLite and PGlite run entirely in-process (WASM) with no network access.

The extension contacts **no Anthropic, vendor, or third-party servers**, and performs no
background phoning-home.

## Data you export

When you use **Export CSV/JSON**, query results are written to a file location you choose.
That file is yours; the extension does nothing further with it.

## Your control

- Remove a saved connection to delete its profile and its stored password.
- Uninstalling the extension removes its stored state.

## Contact

Questions about privacy: **cuongquachc88@gmail.com**
