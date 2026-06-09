// waitlist-admin — founder-only endpoint behind a shared admin token.
//
// Auth: every request must carry  `x-admin-token: <WAITLIST_ADMIN_TOKEN>`.
//
//   GET  ?status=pending|activated|all   → { rows: [...] }   (list signups)
//   POST { action: "activate", email | id, note? }           (grant access)
//        → marks the row activated, stamps activated_at, and emails the person
//          their private app link (APP_URL) via Resend. Returns { ok, emailed }.
//
// The marketing /admin/ page calls this. Because the table has no anon RLS
// policies, this function (service role) is the only way to read/activate.
//
// Deploy:
//   supabase functions deploy waitlist-admin --no-verify-jwt
// Secrets it needs:
//   WAITLIST_ADMIN_TOKEN   long random string — the admin-page password
//   RESEND_API_KEY         Resend key (same one used by the other functions)
//   FROM_EMAIL             e.g. "Lyfos <hello@lyfos.signorvale.com>"
//   APP_URL                the PRIVATE product link sent in the activation email
//   (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically)

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_TOKEN = Deno.env.get("WAITLIST_ADMIN_TOKEN") ?? "";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "Lyfos <hello@lyfos.signorvale.com>";
const APP_URL = Deno.env.get("APP_URL") ?? "https://lyfos.signorvale.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-admin-token",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

function activationEmail(appUrl: string) {
  const subject = "Your Lyfos vault is ready";
  const text =
`Hi,

Good news — your Lyfos access is now active.

You can create your vault here. This link is just for you, so please don't share it publicly:

  ${appUrl}

A few things worth doing in your first sitting:

  1. Pick a passphrase you'll remember — it encrypts everything on your device. We never see it.
  2. Write down your 24-word recovery phrase on paper. It's the only way back if you forget the passphrase.
  3. Add a few records, then name the people who could recover your vault for your family.

Everything stays encrypted on your device. We can never read it — only you, and the people you choose.

Reply to this email if anything is unclear. I read every reply personally.

— Founder, Lyfos`;
  return { subject, text };
}

async function sendEmail(to: string): Promise<boolean> {
  if (!RESEND_KEY) {
    console.warn("[waitlist-admin] RESEND_API_KEY not set — skipping email to", to);
    return false;
  }
  const { subject, text } = activationEmail(APP_URL);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, text }),
  });
  if (!res.ok) {
    console.error("[waitlist-admin] resend error:", res.status, await res.text());
    return false;
  }
  return true;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // --- auth ---
  if (!ADMIN_TOKEN) return json({ error: "admin_not_configured" }, 503);
  const token = req.headers.get("x-admin-token") || "";
  // constant-time-ish compare
  if (token.length !== ADMIN_TOKEN.length || token !== ADMIN_TOKEN) {
    return json({ error: "unauthorized" }, 401);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // --- list ---
  if (req.method === "GET") {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || "all";
    let q = sb
      .from("waitlist")
      .select("id, email, source, status, created_at, activated_at, note")
      .order("status", { ascending: true })       // pending before activated
      .order("created_at", { ascending: true })
      .limit(1000);
    if (status === "pending" || status === "activated") q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return json({ error: "server_error", detail: error.message }, 500);
    return json({ rows: data ?? [] });
  }

  // --- activate ---
  if (req.method === "POST") {
    let body: any = {};
    try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
    const action = String(body.action ?? "activate");
    if (action !== "activate") return json({ error: "unknown_action" }, 400);

    const email = body.email ? String(body.email).trim() : "";
    const id = body.id ? String(body.id) : "";
    if (!email && !id) return json({ error: "email_or_id_required" }, 422);

    const match = sb.from("waitlist");
    const sel = id
      ? match.select("id, email, status").eq("id", id)
      : match.select("id, email, status").ilike("email", email);
    const { data: found, error: findErr } = await sel.limit(1);
    if (findErr) return json({ error: "server_error", detail: findErr.message }, 500);
    if (!found || found.length === 0) return json({ error: "not_found" }, 404);

    const row = found[0];
    const update: any = { status: "activated", activated_at: new Date().toISOString() };
    if (typeof body.note === "string") update.note = body.note.slice(0, 500);
    const { error: upErr } = await sb.from("waitlist").update(update).eq("id", row.id);
    if (upErr) return json({ error: "server_error", detail: upErr.message }, 500);

    const emailed = await sendEmail(row.email);
    return json({ ok: true, id: row.id, email: row.email, emailed });
  }

  return json({ error: "method_not_allowed" }, 405);
});
