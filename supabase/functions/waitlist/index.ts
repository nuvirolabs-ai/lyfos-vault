// waitlist — public endpoint for the marketing site's founding-members form.
//
//   GET                                  → { count }            (people on the list)
//   POST { email, source?, referrer? }   → { ok, position, already? }
//
// Inserts into public.waitlist (de-duped, case-insensitive) using the service
// role, so RLS stays fully locked for everyone else. On a NEW signup (not the
// checklist lead-magnet) it also sends a short "you're on the list"
// confirmation email via Resend, best-effort.
//
// Deploy:  supabase functions deploy waitlist --no-verify-jwt
// (--no-verify-jwt so the static marketing site can POST without an auth token.)
//
// Secrets (optional but recommended, for the confirmation email):
//   RESEND_API_KEY, FROM_EMAIL

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "Lyfos <hello@lyfos.in>";
const APP_URL = Deno.env.get("APP_URL") ?? "https://app.lyfos.in";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function waitlistCount(sb: any): Promise<number> {
  const { count } = await sb.from("waitlist").select("*", { count: "exact", head: true });
  return count ?? 0;
}

function isVaultFallInterest(source: string): boolean {
  return source.startsWith("vault-fall-interest");
}

async function sendConfirmation(to: string, _position: number, source: string): Promise<void> {
  if (!RESEND_KEY) return; // best-effort
  const vaultFall = isVaultFallInterest(source);
  const subject = vaultFall ? "Lyfos Vault launches this fall" : "Welcome to Lyfos — your vault's ready";
  const text = vaultFall ?
`Hi,

You are on the list for Lyfos Vault.

Free Forever is live now. Paid Vault — unlimited entries, personal balance sheet, and Circle of Trust release — opens this fall.

When Vault opens, we will email you first:

  ${APP_URL}

— Founder, Lyfos`
:
`Hi,

Thanks for joining the Lyfos founding members — welcome.

Good news: Lyfos is in open beta, so you don't have to wait. You can create your vault right now, free, in your browser:

  ${APP_URL}

What you're getting:

  • A vault that's encrypted on your device. We can never read it — only you, and the people you choose.
  • The ability to name people who could recover everything for your family, on your terms.
  • Founder pricing, locked for life, for joining early.

From here on you'll only hear from me with the occasional founder note — no spam. Reply any time; I read every email.

— Founder, Lyfos`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, text }),
    });
    if (!res.ok) console.error("[waitlist] confirmation email failed:", res.status, await res.text());
  } catch (e) {
    console.error("[waitlist] confirmation email error:", (e as any)?.message);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Public count for the "N people on the waitlist" label.
  if (req.method === "GET") {
    return json({ count: await waitlistCount(sb) });
  }

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Accept JSON or form-encoded bodies.
  let email = "", source = "marketing", referrer = "";
  try {
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const b = await req.json();
      email = String(b.email ?? "").trim();
      source = String(b.source ?? "marketing").slice(0, 64);
      referrer = String(b.referrer ?? "").slice(0, 300);
    } else {
      const f = await req.formData();
      email = String(f.get("email") ?? "").trim();
      source = String(f.get("source") ?? "marketing").slice(0, 64);
      referrer = String(f.get("referrer") ?? "").slice(0, 300);
    }
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return json({ error: "invalid_email" }, 422);
  }

  const { error } = await sb.from("waitlist").insert({
    email,
    source,
    referrer,
    user_agent: (req.headers.get("user-agent") || "").slice(0, 300),
  });

  // 23505 = unique violation → already on the list; treat as success, no re-email.
  if (error) {
    if ((error as any).code === "23505") {
      if (isVaultFallInterest(source)) {
        await sb
          .from("waitlist")
          .update({
            source,
            referrer,
            user_agent: (req.headers.get("user-agent") || "").slice(0, 300),
          })
          .ilike("email", email);
      }
      return json({ ok: true, already: true, position: await waitlistCount(sb) });
    }
    console.error("[waitlist] insert error:", error.message);
    return json({ error: "server_error" }, 500);
  }

  const position = await waitlistCount(sb);

  // Confirm new waitlist signups (but not checklist lead-magnet downloads).
  if (source !== "checklist") {
    await sendConfirmation(email, position, source);
  }

  return json({ ok: true, position });
});
