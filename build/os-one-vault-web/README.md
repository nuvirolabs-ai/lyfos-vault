# OS-One Vault Web App

This is the first usable local-first product slice.

What works:

- Create an encrypted local vault with a passphrase.
- Unlock and lock the vault.
- Add passwords, PINs, bank details, card details, IDs, insurance policies, documents, and emergency instructions.
- Upload small documents/screenshots into encrypted vault records.
- View saved records and intentionally reveal sensitive values.
- Configure Main Nominee and five key holders.
- Export and import encrypted vault backups.
- Build a static production bundle from `dist/`.

Security boundary:

- Data is encrypted before it is written to browser storage.
- This version is local-first and does not sync secrets to the backend.
- Use test data until the product has independent security review.

Run:

```bash
npm run dev:web
```

Build:

```bash
npm run check
```

Open `apps/web/dist/index.html` through a static server or deploy the `dist/` folder.
