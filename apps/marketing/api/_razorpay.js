import crypto from "node:crypto";

export function normalizeAmount(amount) {
  const value = Number(amount);
  if (!Number.isInteger(value)) throw new Error("amount must be an integer in paise");
  if (value < 100) throw new Error("amount must be at least 100 paise");
  return value;
}

export function getRazorpayConfig() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    const error = new Error("Razorpay credentials are not configured");
    error.statusCode = 401;
    throw error;
  }
  return { keyId, keySecret };
}

export async function createRazorpayOrder({ amount, currency, receipt }) {
  const { keyId, keySecret } = getRazorpayConfig();
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ amount, currency, receipt })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.description || "Could not create Razorpay order");
    error.statusCode = response.status;
    throw error;
  }
  return { keyId, order: data };
}

export function verifyRazorpaySignature({ orderId, paymentId, signature, secret }) {
  if (!orderId || !paymentId || !signature || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

export function sendJson(res, status, payload) {
  res.status(status).setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export function applyCors(req, res) {
  const allowedOrigins = new Set([
    "https://lyfosvault.nuvirolabs.com",
    "https://forgeos.in",
    "https://www.forgeos.in",
    "https://nuvirolabs.com",
    "https://www.nuvirolabs.com"
  ]);
  const origin = req.headers.origin;
  if (allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}
