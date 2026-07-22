import http from "node:http";
import { VAULT_ITEM_TYPES, RELEASE_POLICY } from "@os-one/vault-model";
import { getRazorpayClient, getRazorpayConfig, normalizeAmount, verifyRazorpaySignature } from "./razorpay.js";

const PORT = Number(process.env.PORT ?? 4317);

function sendJson(res, status, payload) {
  res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": process.env.CORS_ORIGIN ?? "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(raw ? JSON.parse(raw) : {}));
    req.on("error", reject);
  });
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") return sendJson(res, 204, {});

      if (req.method === "GET" && req.url === "/health") {
        return sendJson(res, 200, { ok: true, service: "os-one-backend" });
      }

      if (req.method === "GET" && req.url === "/api/v1/vault/item-types") {
        return sendJson(res, 200, { itemTypes: VAULT_ITEM_TYPES });
      }

      if (req.method === "GET" && req.url === "/api/v1/release-policy") {
        return sendJson(res, 200, { releasePolicy: RELEASE_POLICY });
      }

      if (req.method === "POST" && req.url === "/api/v1/vault/items") {
        const body = await readBody(req);
        if (!body.encryptedBlob || !body.itemType) {
          return sendJson(res, 400, { error: "encryptedBlob and itemType are required" });
        }

        return sendJson(res, 201, {
          id: crypto.randomUUID(),
          itemType: body.itemType,
          encryptedBlob: body.encryptedBlob,
          createdAt: new Date().toISOString()
        });
      }

      if (req.method === "POST" && req.url === "/api/create-order") {
        try {
          const body = await readBody(req);
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

      if (req.method === "POST" && req.url === "/api/verify-payment") {
        try {
          const body = await readBody(req);
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

      return sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  });
}

if (process.argv.includes("--check")) {
  console.log("backend syntax ok");
} else {
  createServer().listen(PORT, "127.0.0.1", () => {
    console.log(`OS-One backend listening on http://127.0.0.1:${PORT}`);
  });
}
