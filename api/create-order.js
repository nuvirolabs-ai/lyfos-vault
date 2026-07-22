import { getRazorpayClient, getRazorpayConfig, normalizeAmount, readJson, sendJson } from "./_razorpay.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });

  try {
    const body = await readJson(req);
    const amount = normalizeAmount(body.amount);
    const currency = body.currency || "INR";
    const receipt = body.receipt || `lyfos_${Date.now()}`;
    const order = await getRazorpayClient().orders.create({ amount, currency, receipt });
    const { keyId } = getRazorpayConfig();
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
