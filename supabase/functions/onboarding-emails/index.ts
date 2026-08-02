// Onboarding email sequence — fires daily, sends each user the next
// scheduled email in the 7-email sequence (see docs/marketing/emails/).
//
// Triggered by pg_cron at 09:00 IST daily.
// Idempotency: appends `onboarding_email_sent` events to audit_log with
// the email number; re-runs skip already-sent emails for that user.
//
// Bodies are loaded from `docs/marketing/emails/0X-*.md` at deploy time
// — for simplicity we inline them here. When you change a body, redeploy.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireExternalAppUrl } from "../_shared/public-app-url.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "Lyfos <hello@lyfos.in>";
const APP_URL = requireExternalAppUrl(Deno.env.get("APP_URL") ?? "https://app.lyfos.in");

type Email = { n: number; day: number; subject: string; body: (name: string) => string; condition?: (u: any) => boolean };

const EMAILS: Email[] = [
  {
    n: 1, day: 0,
    subject: "Welcome to Lyfos. Here's how it actually works.",
    body: (name) => `Hi ${name},\n\nWelcome. You just created the first vault that's designed to outlive you, and I wanted to introduce you properly before any feature emails start showing up.\n\nThe 30-second version of how Lyfos works:\n\n  1. You add records — passwords, IDs, accounts, instructions.\n  2. They're encrypted on your device with a passphrase only you know.\n  3. You choose one primary, one backup, and three trusted nominees.\n     The recipient still needs two other nominees plus a 14-day hold.\n\nThat's the whole product. Everything else is in service of that loop.\n\nTwo things I'd ask you to do this week:\n\n  → Add at least 5 records. The Life Map will start to fill in.\n     ${APP_URL}\n\n  → Write down your recovery phrase on paper. If you lose your passphrase, it's the only way back. We don't have a copy.\n\nReply to this email if anything is unclear. I read every reply personally.\n\n— Founder, Lyfos`
  },
  {
    n: 2, day: 1,
    subject: "The 10-minute setup that does the heavy lifting",
    body: (name) => `Hi ${name},\n\nI noticed your vault is still empty. That's normal — most people put off this part for weeks. So here's a 10-minute version that gets you 80% of the way.\n\nOpen Lyfos. Add these six things, in this order:\n\n  1. Your primary email account (the one your bank uses to reset things).\n  2. Your phone's SIM details and PUK code.\n  3. Your most-used bank account.\n  4. The Aadhaar / PAN / passport — whichever ID matters most for you.\n  5. Your health insurance policy.\n  6. A short "first 72 hours" note for whoever finds this.\n\nThat's it. Tomorrow's life feels different when this exists.\n\n  → Open Lyfos: ${APP_URL}\n\nReply with questions any time.\n\n— Founder, Lyfos`,
    condition: (u) => (u.record_count ?? 0) === 0
  },
  {
    n: 3, day: 3,
    subject: "The reason Lyfos exists is the release plan",
    body: (name) => `Hi ${name},\n\nA vault that only you can open is just a password manager. What makes Lyfos different is the release plan — the part where you decide who can get your records to your family when you can't do it yourself.\n\nIt takes about 15 minutes to set up:\n\n  1. Pick five people you trust. Mix categories.\n  2. Choose the primary and backup directly in their invitations.\n  3. Each person accepts using their own Lyfos account.\n  4. You activate one recipient-gated encrypted generation.\n\nAfter that, the primary—or an approved backup—can recover only with two other nominees. A 14-day owner-protection hold and owner alerts still apply.\n\n  → Set up your release plan: ${APP_URL}\n\n— Founder, Lyfos`,
    condition: (u) => !u.release_plan_finalised
  },
  {
    n: 4, day: 7,
    subject: "Don't skip this one. Your recovery phrase.",
    body: (name) => `Hi ${name},\n\nThis is the email I'd rather you read on a quiet evening than skim on a train. It's short.\n\nYour vault is encrypted with your passphrase. If you ever forget that passphrase, the recovery phrase is the only way back in. We don't have a copy. We physically cannot help you if both are lost.\n\nSo before this week ends, please do this:\n\n  1. Open Lyfos → Settings → Security → Recovery phrase.\n  2. Write the 24 words down on paper. Not a photo, not a screenshot. Paper.\n  3. Put the paper where you keep your other "important documents".\n  4. Optionally, write it twice and put the second copy somewhere else.\n\n  → Open Settings: ${APP_URL}\n\n— Founder, Lyfos`,
    condition: (u) => !u.recovery_phrase_downloaded
  },
  {
    n: 5, day: 14,
    subject: "You're almost at the Free Forever limit",
    body: (name) => `Hi ${name},\n\nYou have records approaching the Free Forever cap of 11. Two short notes:\n\n  → If you only need 11 entries, stay on Free Forever. No expiry, no nag screens. We mean it.\n\n  → If you want unlimited entries, personal balance sheet, and the Circle of Trust release plan, that's on Vault at ₹999/year in India or $9/year internationally.\n\nThe release plan is the reason most people upgrade.\n\n  → Upgrade: ${APP_URL}/upgrade?plan=vault\n\nIf you're undecided, reply with what's making you hesitate. I'll either help you stay free, or help you decide.\n\n— Founder, Lyfos`,
    condition: (u) => (u.record_count ?? 0) >= 8 && !u.is_paid
  },
  {
    n: 6, day: 21,
    subject: "One question, honestly",
    body: (name) => `Hi ${name},\n\nYou've been using Lyfos for three weeks now. Long enough to have an opinion, short enough to remember why you signed up.\n\nI have one question. Hit reply with one sentence.\n\n> If you had to describe Lyfos to one friend who hasn't heard of it, what would you tell them?\n\nI read every reply. I'm trying to learn how the product feels to people outside my head, and the answers shape what we build next.\n\n— Founder, Lyfos\n\n(Genuinely. One sentence is enough.)`
  },
  {
    n: 7, day: 30,
    subject: "A month with Lyfos. What changed for you?",
    body: (name) => `Hi ${name},\n\nYou've had a Lyfos vault for thirty days. Whether you opened it once or twenty times, that's longer than most apps last on a phone.\n\nThree short things at the 30-day mark:\n\n  → If you haven't yet, set a monthly reminder to update your balance sheet.\n\n  → If your release plan is still not finalised, that's the single most important thing on your to-do list. Reply if anything is blocking you.\n\n  → Whatever happens next, your vault is yours. If you ever leave Lyfos, you can export the full encrypted record and decrypt it with your passphrase elsewhere.\n\nThank you for trusting us with this. It matters more to me than I can fit in a closing line.\n\n— Founder, Lyfos`
  }
];

const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

async function sendEmail(to: string, subject: string, body: string) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, text: body })
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}

Deno.serve(async () => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let sent = 0, skipped = 0, errored = 0;

  // Pull users whose account was created within the last 31 days
  const { data: users, error } = await sb.rpc("onboarding_email_candidates");
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  for (const u of (users ?? [])) {
    const ageDays = Math.floor((today.getTime() - new Date(u.created_at).getTime()) / 86_400_000);
    const email = EMAILS.find((e) => e.day === ageDays);
    if (!email) { skipped++; continue; }
    if (email.condition && !email.condition(u)) { skipped++; continue; }
    if ((u.emails_sent ?? []).includes(email.n)) { skipped++; continue; }
    try {
      const name = (u.first_name ?? u.email?.split("@")[0]) || "there";
      await sendEmail(u.email, email.subject, email.body(name));
      await sb.from("audit_log").insert({
        user_id: u.user_id,
        event_type: "onboarding_email_sent",
        event_meta: { email_number: email.n, subject: email.subject }
      });
      sent++;
    } catch (e: any) {
      errored++;
      console.error(`failed for ${u.user_id}:`, e?.message);
    }
  }

  return new Response(JSON.stringify({ sent, skipped, errored }), {
    headers: { "Content-Type": "application/json" }
  });
});
