# Changelog

## 2.0.0-beta.1

Breaking changes:

- Windows CLI: zwd, start, stop, config; read-only status, diagnostics, logs and reconciliation.
- Requires Node.js >=24.15 <25; no npm runtime dependencies.
- SQLite accounting in the user's data directory. No automatic import of v1 state/configuration.
- Installation never starts a worker or registers a task. Explicit configuration/commands do.
- Removed legacy launchers and the old auto-spending default configuration from the v2 source tree.

Safety and behavior:

- Durable pre-request budget reservation and operation IDs. Unknown POST results are never automatically retried.
- Process-level single instance and database constraints prevent independent copies from spending concurrently.
- Explicit unlimited budget remains supported. Invalid/missing configuration cannot imply unlimited.
- Shanghai calendar accounting; unresolved operations survive restarts and date changes.
- Week cards are selected first only when the weekly threshold is met, and restore both pools.
- A depleted weekly pool without week cards blocks wasteful five-hour-card consumption.
- Fresh response validation; no inferred quota types or arbitrary stored provider API key selection.
- Post-reset verification before another decision, with per-type cooldowns.
- Graceful persistent stop, Unicode hidden launcher, propagated child exit codes.
- Optional state-change notifications and scheduled heartbeat checks.

Validation boundary:

- Offline fault, multi-process, crash recovery, CLI, Unicode launcher and package tests.
- Read-only GET compatibility checked against the current Z.ai quota and reset-status endpoints.
- No real reset/use POST has been sent by this version. This is a prerelease, not a claim of fully verified live recovery.
