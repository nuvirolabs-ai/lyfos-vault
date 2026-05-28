# Runbook: Razorpay outage or suspension

**Trigger:** webhook stops delivering, checkout sessions fail, KYC suspended,
account temporarily blocked.

## Outage (their fault)

1. Check https://status.razorpay.com.
2. The webhook handler is idempotent — when Razorpay recovers, they retry.
3. Display a banner on the billing page: "Payments are temporarily
   unavailable. Existing subscriptions are unaffected."
4. Do not disable any user's plan during the outage. The `expires_at` field
   is the source of truth, not webhook timing.
5. Update status page.

## Suspension (our problem)

6. Open the Razorpay dashboard, find the suspension reason in the banner.
7. Most common: KYC re-verification (DSC expired, GSTIN status changed,
   business address mismatch).
8. Same-day responses get faster reactivation.
9. If suspension lasts > 24 hours:
   - Disable the "Subscribe" button in the billing UI (toggle in app config).
   - Mark new signups as "free tier only" until restored.
   - Existing subscriptions: do not touch. They run independently.
10. Switch fallback: Stripe stub (`apps/web/src/lib/billing.js` has the
    handler; flip `BILLING_PROVIDER` env to `stripe`). Note: GST invoicing
    needs to switch to manual until Stripe Tax is configured.

## Webhook signature failures

11. Verify `RAZORPAY_WEBHOOK_SECRET` matches dashboard → Settings → Webhooks.
12. Check Edge Function logs for the exact failure (HMAC mismatch vs replay
    vs unknown event).
13. If you rotated the secret, redeploy `razorpay-webhook` immediately.

## Refund scenario

14. Refunds run through Razorpay dashboard. We do not have an in-product
    refund button by design.
15. Issue refund → mark the subscription as `cancelled` in our DB → grace
    period through end of paid term (we do not yank features mid-term).
16. Generate a credit note PDF (manual, see `docs/runbooks/templates/credit-note.md`).
