// waitlist — public endpoint for the marketing site's founding-members form.
//
// POST { email, source?, referrer? }  →  { ok: true }
// Inserts into public.waitlist (de-duped, case-insensitive). Uses the service
// role, so RLS stays fully locked for everyone else.
//
// Deploy:  supabase functions deploy waitlist --no-verify-jwt
// (--no-verify-jwt so the static marketing site can POST without an auth token.)

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
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

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { error } = await sb.from("waitlist").insert({
    email,
    source,
    referrer,
    user_agent: (req.headers.get("user-agent") || "").slice(0, 300),
  });

  // 23505 = unique violation → already on the list; treat as success.
  if (error && (error as any).code !== "23505") {
    console.error("[waitlist] insert error:", error.message);
    return json({ error: "server_error" }, 500);
  }

  return json({ ok: true });
});
