# Safety and operating boundaries

This unofficial tool automates the signed-in user's personal Z.ai Coding Plan reset cards.
It does not buy subscriptions, route model traffic or resume interrupted coding sessions.
Restoring quota does not prove that a task resumed.

## Accounting

The SQLite database stores an operation and reserves budget before the only reset POST.
PREPARED after a crash, UNKNOWN after transport/protocol failure, and APPLIED without observed
quota recovery block further consumption for that account. No automatic POST retry is performed.
Server idempotency retention and retry guarantees are not assumed.

A successful POST consumes budget even if the subsequent GET fails. If an operation spans a
Shanghai date boundary, it counts on both reserved and completion dates conservatively.
An unresolved operation cannot be cleared by midnight, start, stop or a configuration change.
Explicit unlimited removes only the numeric daily cap; all other protections remain.

For an unknown operation, stop the worker and inspect the account. The advanced
reconcile --assume-used ID command conservatively records consumption and retains the charge.
It never refunds budget. It does not prove that the server consumed a card.
There is no automatic refund or reset-ledger command.

One local Windows user can run one v2 worker. Copies use the same default data directory
and OS control channel. This does not coordinate v1 scripts, other Windows users, other
computers, manual resets or the official client. Use one automatic controller per account.

## Credentials and network

Credentials are read and decrypted in memory from ZCode's existing local credentials file.
Only required login/OAuth/user-info entries are decoded. No provider-key prefix guessing is used.
The ZCode JWT identity must match local user-info. The provider's OAuth user ID belongs to
a different namespace; both stable IDs are bound into the ledger identity. A change to
either stops automatic operation. Tokens may rotate without changing that identity.
This is local consistency checking, not independent JWT signature verification or proof
of a server-side mapping between the two identity namespaces.

Only the two fixed official HTTPS hosts are used. Redirects are rejected; TLS validation
stays enabled; no upstream body or raw exception text is printed. Local events and notifications
use fixed messages. There is no telemetry or credential export.

The fallback ZCode encryption derivation is not a security boundary against another process
with the same user's filesystem access. Protect the operating-system account.
The ledger contains a pseudonymous account hash and quota/card data, not credential values.

## Installation, stopping and recovery

No install hooks start processes, create user configuration or register scheduled tasks.
The user must initialize config and explicitly start. Setting autostart on registers the
version-2 user task; registration does not enable spending while desired state is stopped.

Stop first persists desired=stopped, then asks the worker to finish its in-flight request
and exit. An already transmitted request cannot be cancelled reliably. If shutdown cannot
be confirmed within the wait, the CLI reports that clearly. It never kills all Node processes.
If the ledger itself is broken, stop attempts the control channel and task removal, then
reports STOP_UNVERIFIED instead of claiming complete success.

With autostart on, the task starts on login and checks every five minutes. It can recover a
dead worker; it cannot safely terminate a hung worker. A stale heartbeat produces a local
alert at most once per hour. Login, power and network availability still matter; sleeping
computers are not continuously monitored. With autostart off there is no task-based recovery.

Windows notifications are best-effort tray balloons and may be suppressed by Windows policies
or notification settings. Persistent events/status remain the source for diagnosis.
Windows Script Host/VBScript is required for hidden launch in this beta. The tool never
changes Windows optional features or execution policy globally.

## Backups, upgrades and removal

Stop before moving the install directory or upgrading it. The task points to an absolute
installed entrypoint; subsequent start refreshes it. Retain the user data directory across
upgrades and rollbacks. Do not copy an open WAL database's main file alone; stop first and
retain the entire data directory.

Uninstall stops and unregisters the v2 task, retaining the ledger/config. Remove the CLI package
afterwards. Deleting the entire data directory is a separate deliberate operation after
checking unresolved records; it is not an ordinary repair method.

## Verification status

Offline tests use synthetic credentials and mocked APIs. Windows launcher tests run harmless
child programs in temporary directories. Scheduled-task integration is opt-in and intended
only for disposable Windows CI runners, never the user's working machine.
Read-only quota/status compatibility was checked on 2026-10-23. Live reset execution,
desktop notification visibility and future client versions are not established by those checks.
