# Runbook: MSG91 (SMS) or WhatsApp outage

**Trigger:** release alert SMS or WhatsApp messages not delivering.

## SMS via MSG91

1. Check https://control.msg91.com/dashboard for delivery reports.
2. Common causes:
   - **DLT template expired or rejected.** TRAI requires DLT registration in
     India. Re-register the template at https://www.dltconnect.com.
   - **Sender ID changed.** Headers must match the registered sender exactly.
   - **Wallet balance low.** MSG91 stops sending below ₹100. Top up to ₹2000
     minimum.
   - **Phone in NDNC (Do Not Disturb) list.** SMS will fail. We document this
     in onboarding: "Use WhatsApp + email as primary; SMS is a fallback."

## WhatsApp via Meta Cloud API

3. Check https://developers.facebook.com/status.
4. Common causes:
   - **Business verification expired.** Renew at Business Manager → Security.
   - **Template paused.** Meta auto-pauses templates with high block rates.
     Submit a new template at Business Manager → WhatsApp Manager → Message
     Templates.
   - **24-hour window rule.** Outside the 24-hour user-initiated window we
     can only send approved templates. Our release-alert template should be
     pre-approved. Verify it's `APPROVED` status.
   - **Phone number quality rating dropped.** Business Manager → WhatsApp
     Account → Phone Numbers. Below "MEDIUM" we should pause WhatsApp and
     escalate SMS + email.

## Mitigation

5. The release-alert-dispatcher tries all four channels independently. If
   SMS or WhatsApp fails, email + push still deliver. Acceptable.
6. If both SMS + WhatsApp fail simultaneously: this is an India-wide outage
   for our SMB SMS aggregator. Send a banner via push notification.
7. Update the status page.

## Recovery

8. After restoration: re-run `release-alert-dispatcher` for any release
   currently in `holding` state — idempotent per channel per day.

## Cost watch

9. MSG91 ~₹0.25 per SMS, WhatsApp ~₹0.40 per business-initiated message.
   Active release with daily alerts for 14 days × 1 owner: ~₹9 SMS +
   ~₹6 WhatsApp = ₹15 total. Acceptable.
