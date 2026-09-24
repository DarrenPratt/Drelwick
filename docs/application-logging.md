# Application logging

The Electron main process writes structured JSON Lines records to
`<userData>/logs/drelwick.log`. Each record contains an ISO 8601 timestamp,
level, event name and a flat metadata context. The logger keeps three rotated
backups and rotates the active file before it would exceed 1 MiB.

Logged lifecycle and persistence events include application startup and
shutdown, project opening and creation, chapter saves, autosave failures,
recovery scans and decisions, and unhandled main-process or renderer errors.
Project and chapter UUIDs, operation source, duration and stable error
classification give diagnostic context. Renderer failures contribute only a
validated error name through the restricted preload boundary.

Logging metadata must never include manuscript bodies, document or IPC
payloads, project paths, chapter titles, raw errors, error messages, stacks or
causes. The shared `SafeLogger` accepts only flat scalar context. Unknown errors
are reduced to their error name; `ApplicationError` also retains its stable
error code. The file adapter accepts only an explicit allowlist of diagnostic
fields, drops all other context, and never lets a logging failure interrupt
persistence or shutdown.

The renderer has no access to the log directory. It identifies chapter save
requests as `autosave` or `manual` through the validated preload/IPC contract;
the main process performs all log writes.
