# Runbook: Backup & Point-in-time Restore

**Trigger:** data corruption suspected; need to roll back a column / row /
table; need to recover from accidental delete.

## What gets backed up

Supabase Pro tier includes:
- Daily automated backups (7 days retention on Pro, 30 days on Team).
- Point-in-Time Recovery (PITR) to any moment in the retention window.

Free tier has daily backups but NO PITR. Before public launch we MUST be on
Pro (~$25/month) for PITR. This is non-negotiable.

## Restore a single row (preferred when possible)

1. Take a fresh snapshot first (Database → Backups → Manual).
2. In SQL editor:
   ```sql
   -- Inspect history of the row via the audit_log if it's a tracked table
   select * from audit_log
    where (payload->>'target_id') = '<id>'
    order by created_at desc;
   ```
3. Reconstruct the row from the audit payload or from another source (e.g.
   the user's local-first copy if it's their vault).

## Restore a single table

4. PITR to a staging project at the desired moment.
5. Export the table: `pg_dump --table=<table> --data-only ...`.
6. Truncate + restore on prod, or `insert ... on conflict` if a partial
   restore is enough.

## Restore the whole database (last resort)

7. Take a fresh snapshot (so we don't lose anything that happened post-incident).
8. Decide on the restore point. Communicate impact: any data after this
   timestamp will be lost.
9. PITR via Supabase dashboard.
10. Verify the most recent 100 vault_blobs rows post-restore.
11. Force users to re-sync by invalidating their auth tokens (Auth → Users →
    Sign out all).
12. Send a status-page notice.

## After any restore

13. Audit log entry summarising what was restored, by whom, why.
14. Post-mortem if user-visible.
15. Test the death-simulation runbook end-to-end on a fresh test account
    against the restored DB.

## What we cannot restore

- A vault whose passphrase the owner forgot: impossible by design.
- A nominee's recovered emergency bundle that they themselves lost: impossible.
- A user's local vault on a wiped device: only if they had cloud sync enabled
  and it actually pushed before the wipe.
