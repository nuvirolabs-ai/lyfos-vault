# Email template — Breach notification to affected users

Subject: Important: a security incident affecting your Lyfos account

Hi {{name or "there"}},

On {{date}} at {{time IST}} we discovered {{1-sentence summary of what
happened}}. We want to tell you directly what we know, what we don't, and
what we're doing.

## What was exposed

{{Bullet list. Be specific. If it was only encrypted blobs, say "Your
encrypted vault was potentially accessible. Because the contents are
encrypted with a key derived from your passphrase — which we do not store —
an attacker cannot read them without also having your passphrase."}}

## What was NOT exposed

{{Bullet list. Examples: card data (held by Razorpay), recovery phrase (never
sent to us), vault plaintext (never sent to us).}}

## What you should do now

1. {{If passphrase change is recommended, say so.}}
2. {{If session rotation needed, say so.}}
3. {{Watch for phishing emails referencing this incident.}}

## What we're doing

- We have {{stopped the bleed action}}.
- We have engaged {{external IR firm if applicable}} to investigate.
- We will publish a public post-mortem at https://lyfos.signorvale.com/security/incidents within 7 days.
- We have notified the Data Protection Board of India per DPDPA §8(4).

## Apology

This shouldn't have happened, and we're sorry. The whole reason Lyfos uses
end-to-end encryption is to limit damage when something does go wrong, but
that doesn't reduce our responsibility here.

If you have questions, reply directly to this email. The founder reads
every reply personally.

— {{Founder name}}
Founder, Lyfos
