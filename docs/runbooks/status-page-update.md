# Runbook: Update the public status page

We host a minimal static status page at
`https://lyfos.signorvale.com/status/` — see `apps/web/public/status/index.html`.
It's a hand-edited HTML file. No third-party status service yet.

## To declare an incident

1. Open `apps/web/public/status/index.html`.
2. Replace the green `system-green` block with a `system-amber` or
   `system-red` block per the template inside the file.
3. Add an entry to the incident log at the bottom with:
   ```html
   <article>
     <h3>2026-05-28 14:42 IST · Investigating</h3>
     <p>Symptoms: …. Component: …. We're investigating.</p>
   </article>
   ```
4. Build + commit + push. Vercel will deploy in ~30s.
5. Tweet from @lyfos with the status link.

## Subsequent updates

6. Append a new `<article>` under the existing one (do not edit history).
7. Use timestamps in IST. ISO format optional.

## When the incident is resolved

8. Flip the banner back to `system-green`.
9. Add a final article: `Resolved at HH:MM IST.`
10. Within 7 days: write a post-mortem and link it from the incident.

## Migrating to a hosted status service

When we cross 500 paid users, move to:
- **Instatus** (~$20/month) — clean, supports incident subscribers.
- **Statuspage by Atlassian** (~$29/month) — bigger feature set, heavier.

Until then, the static page is good enough and never has its own outage.
