# OS-One Vault Workspace

This workspace keeps the landing page separate from the product app.

## Product App

Run locally:

```bash
npm run dev:web
```

Build and package downloadable static web app:

```bash
npm run package:web
```

Output:

```text
build/os-one-vault-web.zip
```

Current security boundary:

- Local-first encrypted vault.
- Passphrase-derived AES-GCM encryption before browser storage.
- Encrypted backup export/import.
- No cloud sync of secrets yet.

Do not market this as bank-grade or use it with real sensitive data until independent security review, native secure storage, audited recovery, and signed desktop builds are complete.
