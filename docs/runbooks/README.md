# Operational Runbooks

These are the playbooks the founder (or any future on-call) runs when
something is wrong. Keep them short and step-by-step. Each one should be
runnable at 03:00 with one coffee.

| Runbook                                          | When to run                                            |
|--------------------------------------------------|--------------------------------------------------------|
| [data-breach.md](data-breach.md)                 | Suspected or confirmed unauthorised data access        |
| [supabase-outage.md](supabase-outage.md)         | Supabase region down or degraded                       |
| [razorpay-outage.md](razorpay-outage.md)         | Razorpay webhook failing or KYC suspended              |
| [resend-outage.md](resend-outage.md)             | Email alerts failing                                   |
| [msg91-or-whatsapp-outage.md](msg91-or-whatsapp-outage.md) | SMS or WhatsApp alerts failing               |
| [release-engine-bug.md](release-engine-bug.md)   | Suspected bug in claim / hold / abort / combine flow   |
| [account-compromise.md](account-compromise.md)   | User reports their account was taken over              |
| [founder-bus-factor.md](founder-bus-factor.md)   | Plan for if the founder is unavailable / incapacitated |
| [backup-restore.md](backup-restore.md)           | Point-in-time recovery of the Supabase database        |
| [status-page-update.md](status-page-update.md)   | How to update the public status page during an incident |
