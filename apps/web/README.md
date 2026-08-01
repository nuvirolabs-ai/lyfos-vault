# Lyfos Vault Web App

This is the open-source Free Forever web app for Lyfos Vault.

What works:

- Create an encrypted local vault with a passphrase.
- Unlock and lock the vault.
- Add passwords, PINs, bank details, card details, IDs, insurance policies, documents, and emergency instructions.
- Upload small documents/screenshots into encrypted vault records.
- View saved records and intentionally reveal sensitive values.
- Export and import encrypted vault backups.

Security boundary:

- Data is encrypted before it is written to browser storage.
- Cloud features are optional and require your own Supabase project.
- Use test data until you understand the security boundary.

Run:

```bash
npm run dev:web
```

Build:

```bash
npm run build -w @os-one/web
```

Deploy the generated `apps/web/dist/` folder to a static host.
