import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveHolderKeypairFromPassphrase,
  makeReleaseProcessKeypair,
  splitVaultKey,
  combineShares,
  sealShareToPubkey,
  openSealedShare,
  shareStringToBytes,
  bytesToShareString
} from "./shareCrypto.js";

function randomKey() {
  const k = new Uint8Array(32);
  for (let i = 0; i < 32; i++) k[i] = i * 7 % 256;
  return k;
}

test("splitVaultKey produces 5 shares with 3-of-5 threshold", async () => {
  const key = randomKey();
  const shares = await splitVaultKey(key);
  assert.equal(shares.length, 5);
  for (const s of shares) {
    assert.equal(typeof s, "string");
    assert.ok(s.length > 0);
  }
});

test("combineShares recovers the key from exactly 3 shares", async () => {
  const key = randomKey();
  const shares = await splitVaultKey(key);
  const subset = [shares[0], shares[2], shares[4]];
  const recovered = await combineShares(subset);
  assert.deepEqual(Array.from(recovered), Array.from(key));
});

test("combineShares works with all 5 shares too", async () => {
  const key = randomKey();
  const shares = await splitVaultKey(key);
  const recovered = await combineShares(shares);
  assert.deepEqual(Array.from(recovered), Array.from(key));
});

test("combineShares rejects fewer than 3 shares", async () => {
  await assert.rejects(() => combineShares([{}, {}]), /at least 3 shares/);
});

test("splitVaultKey rejects non-Uint8Array input", async () => {
  await assert.rejects(() => splitVaultKey("not a uint8array"));
});

test("splitVaultKey rejects non-32-byte input", async () => {
  await assert.rejects(() => splitVaultKey(new Uint8Array(16)), /32 bytes/);
});

test("deriveHolderKeypairFromPassphrase is deterministic per (passphrase, userId)", async () => {
  const passphrase = "correct horse battery staple test";
  const userId = "00000000-aaaa-bbbb-cccc-000000000001";
  const a = await deriveHolderKeypairFromPassphrase(passphrase, userId);
  const b = await deriveHolderKeypairFromPassphrase(passphrase, userId);
  assert.equal(a.publicKey, b.publicKey);
  assert.equal(a.secretKey, b.secretKey);
});

test("deriveHolderKeypairFromPassphrase varies by userId", async () => {
  const passphrase = "same passphrase";
  const a = await deriveHolderKeypairFromPassphrase(passphrase, "user-1");
  const b = await deriveHolderKeypairFromPassphrase(passphrase, "user-2");
  assert.notEqual(a.publicKey, b.publicKey);
  assert.notEqual(a.secretKey, b.secretKey);
});

test("deriveHolderKeypairFromPassphrase varies by passphrase", async () => {
  const userId = "same-user";
  const a = await deriveHolderKeypairFromPassphrase("phrase one", userId);
  const b = await deriveHolderKeypairFromPassphrase("phrase two", userId);
  assert.notEqual(a.publicKey, b.publicKey);
});

test("sealShareToPubkey / openSealedShare round-trip recovers original bytes", async () => {
  const kp = await makeReleaseProcessKeypair();
  const payload = new TextEncoder().encode("hello-share-payload-12345");

  const sealed = await sealShareToPubkey(payload, kp.publicKey);
  assert.ok(sealed.ciphertext);
  assert.ok(sealed.ephemeralPub);

  const recovered = await openSealedShare(sealed, kp.secretKey);
  assert.deepEqual(Array.from(recovered), Array.from(payload));
});

test("openSealedShare with the wrong secret key fails", async () => {
  const kp = await makeReleaseProcessKeypair();
  const wrong = await makeReleaseProcessKeypair();
  const payload = new TextEncoder().encode("secret-stuff");
  const sealed = await sealShareToPubkey(payload, kp.publicKey);

  await assert.rejects(() => openSealedShare(sealed, wrong.secretKey));
});

test("openSealedShare with a tampered ciphertext fails", async () => {
  const kp = await makeReleaseProcessKeypair();
  const payload = new TextEncoder().encode("secret-stuff");
  const sealed = await sealShareToPubkey(payload, kp.publicKey);

  // Flip a bit somewhere in the middle of the ciphertext.
  const flipped = { ...sealed, ciphertext: sealed.ciphertext.replace(/.$/, (c) => c === "A" ? "B" : "A") };
  await assert.rejects(() => openSealedShare(flipped, kp.secretKey));
});

test("end-to-end: 3 holders re-encrypt their shares to a nominee, nominee recovers key", async () => {
  // Owner: split her vault key
  const ownerKey = randomKey();
  const shares = await splitVaultKey(ownerKey);

  // 5 holder keypairs (each from her own passphrase)
  const holders = await Promise.all(
    [1,2,3,4,5].map((i) => deriveHolderKeypairFromPassphrase(`holder-${i} passphrase`, `holder-${i}-id`))
  );

  // Owner encrypts share[i] to holder[i].publicKey
  const ownerSealed = await Promise.all(
    shares.map((s, i) => sealShareToPubkey(shareStringToBytes(s), holders[i].publicKey))
  );

  // Nominee generates a per-request keypair
  const nominee = await makeReleaseProcessKeypair();

  // 3 holders (say 0, 2, 4) approve. Each decrypts her share, then
  // re-encrypts to the nominee's pubkey.
  const releasedIdxs = [0, 2, 4];
  const releasedSealed = await Promise.all(releasedIdxs.map(async (i) => {
    const myShareBytes = await openSealedShare(ownerSealed[i], holders[i].secretKey);
    return sealShareToPubkey(myShareBytes, nominee.publicKey);
  }));

  // Nominee unwraps each released share
  const nomineeShares = await Promise.all(
    releasedSealed.map((sealed) => openSealedShare(sealed, nominee.secretKey).then((bytes) => bytesToShareString(bytes)))
  );

  // Combine → original vault key
  const recovered = await combineShares(nomineeShares);
  assert.deepEqual(Array.from(recovered), Array.from(ownerKey));
});
