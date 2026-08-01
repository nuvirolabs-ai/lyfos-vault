import { applyCors, createRazorpayOrder, normalizeAmount, readJson, sendJson } from "./_razorpay.js";

const PAID_LAUNCH_LOCKED = (process.env.PAID_LAUNCH_LOCKED ?? "true") !== "false";

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  if (PAID_LAUNCH_LOCKED) {
    return sendJson(res, 423, { error: "Vault launches this fall. Join the launch list instead." });
  }

  try {
    const body = await readJson(req);
    const amount = normalizeAmount(body.amount);
    const currency = body.currency || "INR";
    const receipt = body.receipt || `lyfos_${Date.now()}`;
    const { keyId, order } = await createRazorpayOrder({ amount, currency, receipt });
    return sendJson(res, 200, {
      key_id: keyId,
      order_id: order.id,
      amount: order.amount,
      currency: order.currency
    });
  } catch (error) {
    const status = error.statusCode === 401 ? 401 : error.message?.includes("amount") ? 400 : 500;
    return sendJson(res, status, { error: status === 500 ? "Could not create Razorpay order" : error.message });
  }
}
