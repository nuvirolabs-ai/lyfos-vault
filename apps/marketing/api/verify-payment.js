import { applyCors, getRazorpayConfig, readJson, sendJson, verifyRazorpaySignature } from "./_razorpay.js";

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });

  try {
    const body = await readJson(req);
    const orderId = body.razorpay_order_id;
    const paymentId = body.razorpay_payment_id;
    const signature = body.razorpay_signature;
    if (!orderId || !paymentId || !signature) {
      return sendJson(res, 400, { error: "razorpay_order_id, razorpay_payment_id, and razorpay_signature are required" });
    }

    const { keySecret } = getRazorpayConfig();
    const verified = verifyRazorpaySignature({ orderId, paymentId, signature, secret: keySecret });
    if (!verified) return sendJson(res, 400, { success: false, error: "Invalid payment signature" });

    return sendJson(res, 200, { success: true, payment_id: paymentId, order_id: orderId });
  } catch (error) {
    const status = error.statusCode === 401 ? 401 : 500;
    return sendJson(res, status, { error: status === 500 ? "Could not verify payment" : error.message });
  }
}
