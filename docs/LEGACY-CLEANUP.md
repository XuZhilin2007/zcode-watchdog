# Retiring a v1 installation

Do not run both v1 and v2 automatic controllers. This document describes a manual future
cleanup; installing or testing v2 does not run these steps.

1. Inspect the task named ZCodeWatchdog, including its action and target path. Record the
   installed folder and process chain before making changes.
2. Disable the old task first so that its five-minute trigger cannot recreate the worker.
3. Stop the task. Inspect the exact wscript/node command lines and parent-child relationship
   again; a child can survive its parent. A BAT launcher can also restart Node.
4. Stop only verified processes belonging to that installation. Revalidate process ID,
   creation time and full command line immediately before termination. Never use a
   machine-wide command that terminates every node.exe, wscript.exe or cmd.exe.
5. Unregister the old task, then verify the old process chain is absent and remains absent
   past the next scheduled repetition.
6. Back up desired logs/state and archive or remove only the verified v1 installation.
   Do not remove ZCode's own credentials/configuration or the new v2 user data directory.

The old uninstall-task.ps1 suppresses errors and does not prove all descendants exited.
Use actual task/process checks rather than its success text.
Fresh process IDs must be collected at cleanup time; old inventory IDs are not safe targets.

Personal machine paths and process inventories are intentionally not included in the release.
