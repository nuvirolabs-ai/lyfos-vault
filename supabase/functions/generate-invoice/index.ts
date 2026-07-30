// Lyfos — invoice generator.
//
// Called by the Razorpay webhook (or manually for a billing_events row)
// once a payment is captured. Builds a GST-compliant tax invoice for
// the user's billing_profile, stores it as HTML in the invoices bucket,
// and stamps invoice_number + invoice_pdf_path on the billing_events row.
//
// We deliberately ship HTML, not PDF, in the Edge function. Reasons:
//   - Deno-on-Supabase doesn't have a stable headless-Chromium binary
//   - Browsers render the HTML perfectly and let the user "Save as PDF"
//     for any actual accountant submission
//   - The on-disk format stays diffable in source control if we ever
//     need to reproduce an old invoice
//
// Required secrets (one-time):
//   LYFOS_GSTIN         — your GSTIN (e.g. "27AABCU1234D1Z5")
//   LYFOS_LEGAL_NAME    — registered name (e.g. "Lyfos Technologies Private Limited")
//   LYFOS_ADDRESS       — registered address
//   LYFOS_STATE_CODE    — your state code ("27" = Maharashtra)
//   LYFOS_PAN           — optional but recommended
//
// For B2C without buyer GSTIN we apply 18% GST split as:
//   - 9% CGST + 9% SGST when buyer state == seller state (intra-state)
//   - 18% IGST when buyer state != seller state (inter-state)
// HSN for SaaS: 9984.

// @ts-ignore Deno
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.2";

// @ts-ignore
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
// @ts-ignore
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// @ts-ignore
const SELLER_GSTIN  = Deno.env.get("LYFOS_GSTIN") ?? "";
// @ts-ignore
const SELLER_NAME   = Deno.env.get("LYFOS_LEGAL_NAME") ?? "Lyfos";
// @ts-ignore
const SELLER_ADDR   = Deno.env.get("LYFOS_ADDRESS") ?? "";
// @ts-ignore
const SELLER_STATE  = Deno.env.get("LYFOS_STATE_CODE") ?? "27";
// @ts-ignore
const SELLER_PAN    = Deno.env.get("LYFOS_PAN") ?? "";

const HSN_SAAS = "9984";
const GST_RATE = 0.18; // 18%

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const eventId = body?.event_id;
  if (!eventId) return json({ ok: false, error: "event_id required" }, 400);

  // Load the billing event
  const { data: event, error: evErr } = await admin
    .from("billing_events")
    .select("*")
    .eq("id", eventId)
    .maybeSingle();
  if (evErr) return json({ ok: false, error: evErr.message }, 500);
  if (!event) return json({ ok: false, error: "event not found" }, 404);
  if (event.invoice_pdf_path) {
    return json({ ok: true, already: true, invoice_number: event.invoice_number, path: event.invoice_pdf_path });
  }
  if (!event.amount_paise || !event.user_id) {
    return json({ ok: false, error: "event missing amount or user_id" }, 400);
  }

  // Load buyer profile + auth.users for email/name
  const [{ data: profile }, { data: who }] = await Promise.all([
    admin.from("billing_profile").select("*").eq("user_id", event.user_id).maybeSingle(),
    admin.auth.admin.getUserById(event.user_id)
  ]);

  // Allocate invoice number
  const { data: invNum, error: invNumErr } = await admin.rpc("allocate_invoice_number");
  if (invNumErr) return json({ ok: false, error: invNumErr.message }, 500);
  const invoiceNumber = invNum as string;

  // GST math: amount paid is gross (incl. GST). Decompose.
  const gross = event.amount_paise / 100; // INR
  const taxable = +(gross / (1 + GST_RATE)).toFixed(2);
  const gstTotal = +(gross - taxable).toFixed(2);

  const buyerState = profile?.state_code ?? null;
  const interState = buyerState && buyerState !== SELLER_STATE;
  const cgst = interState ? 0 : +(gstTotal / 2).toFixed(2);
  const sgst = interState ? 0 : +(gstTotal / 2).toFixed(2);
  const igst = interState ? gstTotal : 0;

  const html = renderInvoiceHtml({
    invoiceNumber,
    issuedAt: new Date(event.created_at),
    seller: { name: SELLER_NAME, gstin: SELLER_GSTIN, address: SELLER_ADDR, stateCode: SELLER_STATE, pan: SELLER_PAN },
    buyer: {
      name: profile?.legal_name ?? who?.user?.user_metadata?.name ?? (who?.user?.email ?? "Customer"),
      email: who?.user?.email ?? "",
      gstin: profile?.gstin ?? null,
      stateName: profile?.state_name ?? null,
      stateCode: buyerState,
      address: [profile?.address_line1, profile?.address_line2, profile?.city, profile?.pincode].filter(Boolean).join(", ")
    },
    line: {
      description: "Lyfos Vault — annual subscription",
      hsn: HSN_SAAS,
      taxable,
      cgst, sgst, igst,
      total: gross
    },
    paymentId: event.provider_payment_id ?? null
  });

  const path = `${event.user_id}/${invoiceNumber}.html`;
  const { error: upErr } = await admin.storage
    .from("invoices")
    .upload(path, new Blob([html], { type: "text/html" }), { upsert: false, contentType: "text/html" });
  if (upErr) return json({ ok: false, error: `upload: ${upErr.message}` }, 500);

  // Stamp the billing event with the invoice details
  await admin.from("billing_events").update({
    invoice_number: invoiceNumber,
    invoice_pdf_path: path,
    invoice_state: buyerState,
    invoice_gstin: profile?.gstin ?? null
  }).eq("id", eventId);

  return json({ ok: true, invoice_number: invoiceNumber, path });
});

// ============================================================
// Invoice HTML
// ============================================================
function renderInvoiceHtml({ invoiceNumber, issuedAt, seller, buyer, line, paymentId }: any): string {
  const fmtINR = (n: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
  return `<!doctype html><html><head><meta charset="utf-8">
<title>Tax Invoice ${esc(invoiceNumber)}</title>
<style>
  * { box-sizing: border-box }
  body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; color: #1d1d1f; margin: 0; padding: 48px 32px; background: #fff; -webkit-font-smoothing: antialiased; }
  .wrap { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 22px; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 4px; }
  .label { font-size: 10px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: #86868b; }
  .row { display: flex; justify-content: space-between; gap: 24px; }
  .col { flex: 1; }
  hr { border: none; border-top: 1px solid rgba(0,0,0,0.1); margin: 24px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { padding: 8px 6px; font-size: 12px; text-align: left; vertical-align: top; }
  th { border-bottom: 1px solid rgba(0,0,0,0.15); font-weight: 600; }
  td { border-bottom: 1px solid rgba(0,0,0,0.05); }
  .right { text-align: right; }
  .totals { margin-top: 16px; width: 100%; }
  .totals td { border: none; padding: 4px 6px; font-size: 13px; }
  .grand { font-size: 16px; font-weight: 700; border-top: 1px solid rgba(0,0,0,0.2); padding-top: 10px !important; }
  .foot { font-size: 10px; color: #6e6e73; margin-top: 32px; line-height: 1.5; }
  .pill { display: inline-block; padding: 2px 8px; border: 1px solid rgba(0,0,0,0.15); border-radius: 999px; font-size: 10px; font-weight: 600; }
</style></head>
<body><div class="wrap">

  <div class="row" style="align-items: flex-start">
    <div class="col">
      <p class="label">Tax Invoice</p>
      <h1>${esc(invoiceNumber)}</h1>
      <p style="font-size:12px; color:#6e6e73; margin:0">Issued ${issuedAt.toLocaleDateString("en-IN")}</p>
    </div>
    <div class="col right">
      <span class="pill">Original copy for buyer</span>
    </div>
  </div>

  <hr />

  <div class="row">
    <div class="col">
      <p class="label">Seller</p>
      <p style="margin:4px 0 0; font-weight:600">${esc(seller.name)}</p>
      <p style="margin:2px 0; font-size:11px; color:#6e6e73">${esc(seller.address || "")}</p>
      ${seller.gstin ? `<p style="margin:6px 0 0; font-size:11px">GSTIN: <strong>${esc(seller.gstin)}</strong></p>` : ""}
      ${seller.pan   ? `<p style="margin:2px 0; font-size:11px">PAN: ${esc(seller.pan)}</p>` : ""}
      <p style="margin:2px 0; font-size:11px">State code: ${esc(seller.stateCode)}</p>
    </div>
    <div class="col">
      <p class="label">Buyer</p>
      <p style="margin:4px 0 0; font-weight:600">${esc(buyer.name)}</p>
      <p style="margin:2px 0; font-size:11px; color:#6e6e73">${esc(buyer.email)}</p>
      ${buyer.address ? `<p style="margin:2px 0; font-size:11px; color:#6e6e73">${esc(buyer.address)}</p>` : ""}
      ${buyer.gstin ? `<p style="margin:6px 0 0; font-size:11px">GSTIN: <strong>${esc(buyer.gstin)}</strong></p>` : ""}
      ${buyer.stateName ? `<p style="margin:2px 0; font-size:11px">State: ${esc(buyer.stateName)} (${esc(buyer.stateCode || "")})</p>` : ""}
    </div>
  </div>

  <hr />

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th>HSN</th>
        <th class="right">Taxable value</th>
        ${line.igst ? `<th class="right">IGST (18%)</th>` :
                       `<th class="right">CGST (9%)</th><th class="right">SGST (9%)</th>`}
        <th class="right">Total</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${esc(line.description)}</td>
        <td>${esc(line.hsn)}</td>
        <td class="right">${fmtINR(line.taxable)}</td>
        ${line.igst ? `<td class="right">${fmtINR(line.igst)}</td>` :
                       `<td class="right">${fmtINR(line.cgst)}</td><td class="right">${fmtINR(line.sgst)}</td>`}
        <td class="right">${fmtINR(line.total)}</td>
      </tr>
    </tbody>
  </table>

  <table class="totals">
    <tr><td class="right" style="color:#6e6e73">Taxable value</td><td class="right" style="width:140px">${fmtINR(line.taxable)}</td></tr>
    ${line.igst
      ? `<tr><td class="right" style="color:#6e6e73">IGST (18%)</td><td class="right">${fmtINR(line.igst)}</td></tr>`
      : `<tr><td class="right" style="color:#6e6e73">CGST (9%)</td><td class="right">${fmtINR(line.cgst)}</td></tr>
         <tr><td class="right" style="color:#6e6e73">SGST (9%)</td><td class="right">${fmtINR(line.sgst)}</td></tr>`
    }
    <tr><td class="right grand">Grand total</td><td class="right grand">${fmtINR(line.total)}</td></tr>
  </table>

  ${paymentId ? `<p style="margin-top:24px; font-size:11px; color:#6e6e73">Payment reference: <span style="font-family: monospace">${esc(paymentId)}</span></p>` : ""}

  <p class="foot">
    Place of supply: ${esc(buyer.stateName ?? (line.igst ? "Inter-state" : "Intra-state"))}.
    ${line.igst
      ? "This is an inter-state supply; IGST has been applied as per Section 7 of the IGST Act."
      : "This is an intra-state supply; CGST + SGST applied as per Section 8 of the CGST Act."}
    HSN 9984 — Information Technology software services (online software supply). Reverse charge mechanism does not apply.
    This invoice is computer-generated and does not require a signature. For queries, write to hello@lyfos.in.
  </p>

</div></body></html>`;
}

function esc(s: any): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]!));
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
