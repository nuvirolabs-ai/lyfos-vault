# OS-One Desktop App

This folder is reserved for the native Mac and Windows desktop app.

The recommended desktop shell is Tauri because it keeps the app smaller and closer to native platform security than a heavy Electron shell.

Current environment note: Rust/Cargo is not installed on this machine, so the native Tauri shell cannot be built yet. Install Rust before adding `@tauri-apps/cli` and generating the full desktop shell.

Planned responsibilities:

- Wrap the shared web UI in a native desktop shell.
- Store device-bound unlock material in OS secure storage.
- Support local encrypted cache.
- Provide secure file import from Finder and Windows Explorer.
- Ship signed auto-updates.

