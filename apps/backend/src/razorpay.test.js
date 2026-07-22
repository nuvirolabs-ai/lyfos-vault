import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { normalizeAmount, verifyRazorpaySignature } from "./razorpay.js";

test("normalizeAmount rejects amounts below Razorpay minimum", () => {
  assert.throws(() => normalizeAmount(99), /at least 100 paise/);
});

test("normalizeAmount accepts integer paise", () => {
  assert.equal(normalizeAmount(99900), 99900);
});

test("verifyRazorpaySignature validates Razorpay HMAC", () => {
  const secret = "test_secret";
  const orderId = "order_lyfos";
  const paymentId = "pay_lyfos";
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  assert.equal(verifyRazorpaySignature({ orderId, paymentId, signature, secret }), true);
  assert.equal(verifyRazorpaySignature({ orderId, paymentId, signature: "bad", secret }), false);
});
