// Lyfos — nominee combine + download.
//
// Reachable at /download. Shows the active release_request raised by
// the signed-in user. If state === 'ready_to_release', she can combine
// the shares released to her, decrypt the owner's vault, filter to
// emergency-eligible records, and download a JSON bundle.
//
// All of this happens client-side. The Lyfos server only ever sees
// ciphertext at each step.

import React, { useEffect, useState } from "react";
import { AuthScreen } from "./AuthScreen.jsx";
import { getSession, onAuthStateChange } from "./lib/auth.js";
import { fetchSharesReleasedFor, fetchMyReleaseRequests } from "./lib/releaseClaim.js";
import { nomineeReleaseTimeline, RELEASE_KEY_STORAGE_PREFIX, retrieveReleaseProcessSecret } from "./lib/nomineeReleaseFlow.js";
import { openSealedShare, combineShares, bytesToShareString } from "./lib/shareCrypto.js";
import { getSupabase } from "./lib/supabaseClient.js";

export function NomineeDownloadScreen({ onReturnHome }) {
  const [session, setSession] = useState(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [request, setRequest] = useState(null);
  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [combining, setCombining] = useState(false);
  const [done, setDone] = useState(false);
  const [recordCount, setRecordCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getSession()
      .then((s) => { if (!cancelled) { setSession(s); setSessionLoaded(true); } })
      .catch(() => { if (!cancelled) setSessionLoaded(true); });
    const unsubscribe = onAuthStateChange((next) => {
      if (!cancelled) { setSession(next); setSessionLoaded(true); }
    });
    return () => { cancelled = true; unsubscribe(); };
  }, []);

  async function refresh() {
    if (!session) return;
    setLoading(true);
    setError("");
    try {
      const all = await fetchMyReleaseRequests();
      const inflight = all.find((r) => ["pending_review","approved","awaiting_shares","holding","ready_to_release"].includes(r.state));
      setRequest(inflight ?? all[0] ?? null);
      if (inflight) {
        setShares(await fetchSharesReleasedFor(inflight.id));
      } else {
        setShares([]);
      }
    } catch (err) {
      setError(err?.message || "Couldn't load.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, [session?.user?.id]);

  async function combineAndDownload() {
    if (!request) return;
    setCombining(true);
    setError("");
    try {
      // 1. Get the per-claim release_process secretKey from sessionStorage.
      //    The claim screen stashed it keyed by the claim_token used at
      //    file time. We don't have the claim_token here; we stashed
      //    under the claim_token AND under request_id for resilience.
      const secretKey = retrieveReleaseProcessSecret({ requestId: request.id });
      if (!secretKey) {
        throw new Error("Couldn't find your release process key in this browser session. You must use the same browser tab + session you used when filing the claim.");
      }

      // 2. Decrypt each released share with my secret key
      const shareStrings = [];
      for (const s of shares) {
        const bytes = await openSealedShare(
          { ciphertext: s.ciphertext, ephemeralPub: s.ephemeral_pub },
          secretKey
        );
        shareStrings.push(bytesToShareString(bytes));
      }

      if (shareStrings.length < 3) {
        throw new Error(`Only ${shareStrings.length} shares released so far. Need 3 to combine.`);
      }

      // 3. Combine via SSS → raw 32-byte vault key
      const rawVaultKey = await combineShares(shareStrings);

      // 4. Fetch the owner's encrypted vault blob via the nominee_get_vault_blob RPC
      const sb = getSupabase();
      const { data: blobRows, error: blobErr } = await sb.rpc("nominee_get_vault_blob", { p_request_id: request.id });
      if (blobErr) throw blobErr;
      if (!blobRows || blobRows.length === 0) throw new Error("Couldn't fetch the encrypted vault.");
      const blob = blobRows[0];

      // 5. Decrypt the vault blob client-side. The encrypted_record is
      //    a Stage 1 record { encryptedVault: { iv, ciphertext } } whose
      //    payload is encrypted to rawVaultKey.
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        rawVaultKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"]
      );
      // Zero rawVaultKey now that the CryptoKey holds the secret
      for (let i = 0; i < rawVaultKey.length; i++) rawVaultKey[i] = 0;

      const encryptedVault = blob.encrypted_record?.encryptedVault;
      if (!encryptedVault?.iv || !encryptedVault?.ciphertext) {
        throw new Error("Encrypted vault payload missing");
      }
      const iv = base64ToBytes(encryptedVault.iv);
      const ct = base64ToBytes(encryptedVault.ciphertext);
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, ct);
      const vault = JSON.parse(new TextDecoder().decode(plaintext));

      // 6. Filter to emergency-eligible records
      const emergencyItems = (vault.items ?? []).filter((it) => it.emergencyEligible);
      setRecordCount(emergencyItems.length);

      // 7. Build a single JSON bundle. (ZIP-with-PDFs is a future
      // enhancement; for v1 we emit one JSON file the nominee can save.)
      const bundle = {
        kind: "lyfos-emergency-bundle",
        version: 1,
        owner_email: request.nominee_email_at_request, // not strictly the owner email — kept for cross-reference
        released_at: new Date().toISOString(),
        items: emergencyItems
      };
      const json = JSON.stringify(bundle, null, 2);
      const blobUrl = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `lyfos-emergency-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(blobUrl);

      // 8. Mark the request completed
      await sb.rpc("nominee_mark_completed", { p_request_id: request.id });
      // Best-effort cleanup of the session-stashed secret
      try { sessionStorage.removeItem(RELEASE_KEY_STORAGE_PREFIX + request.id); } catch {}
      setDone(true);
    } catch (err) {
      setError(err?.message || "Couldn't combine.");
    } finally {
      setCombining(false);
    }
  }

  if (!sessionLoaded) return <main className="min-h-screen bg-[#fbfbfd]" aria-hidden="true" />;

  if (!session) {
    return (
      <div>
        <div className="mx-auto max-w-md px-5 pt-12 text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#86868b]">Nominee download</p>
          <h1 className="mt-3 text-[28px] font-semibold leading-tight tracking-tight">Check your release request.</h1>
          <p className="mt-3 text-[13px] text-[#86868b]">Sign in with the nominee email used when the claim was filed.</p>
        </div>
        <div className="mt-6">
          <AuthScreen onSignedIn={(s) => setSession(s)} />
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#fbfbfd] text-[#1d1d1f]">
      <div className="mx-auto max-w-xl px-5 py-12">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#86868b]">Lyfos · Nominee</p>
        <h1 className="mt-2 text-[30px] font-semibold tracking-tight">Release status</h1>
        <p className="mt-3 text-[14px] leading-6 text-[#6e6e73]">
          This is where a nominee follows the release request from review to download. The vault is not opened until 3 trusted people release keys and the owner-protection hold finishes.
        </p>

        {loading && <p className="mt-6 text-[14px] text-[#86868b]">Loading…</p>}

        {!loading && !request && (
          <div className="mt-8 rounded-2xl border border-dashed border-black/12 bg-white p-6 text-center">
            <p className="text-[14px] font-medium">No release request found for this account.</p>
            <button onClick={onReturnHome} className="mt-4 rounded-full bg-[#1d1d1f] px-5 py-2 text-[12px] font-semibold text-white">Go home</button>
          </div>
        )}

        {!loading && request && (
          <div className="mt-8 space-y-4">
            <Status request={request} sharesCount={shares.length} />

            {error && <div className="rounded-xl bg-[#ff453a]/8 px-4 py-3 text-[13px] font-medium text-[#b42318]">{error}</div>}

            {done ? (
              <div className="rounded-2xl border border-[#34c759]/30 bg-[#34c759]/8 p-5">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#0b6b3a]">Download saved</p>
                <p className="mt-1 text-[14px]">Your emergency bundle was saved to your downloads. It contains {recordCount} record{recordCount === 1 ? "" : "s"} marked emergency-eligible.</p>
                <p className="mt-3 text-[12px] text-[#0b6b3a]/85">Store this file somewhere safe and offline (an encrypted USB drive, a printed reference, etc.) — Lyfos cannot regenerate it for you.</p>
              </div>
            ) : request.state === "ready_to_release" && shares.length >= 3 ? (
              <button
                onClick={combineAndDownload}
                disabled={combining}
                className="w-full rounded-full bg-[#1d1d1f] px-5 py-3 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(0,0,0,0.12)] disabled:opacity-50"
              >
                {combining ? "Combining…" : "Combine shares and download"}
              </button>
            ) : (
              <div className="rounded-2xl border border-black/8 bg-white p-5">
                <p className="text-[12px] font-semibold text-[#1d1d1f]">Next</p>
                <p className="mt-1 text-[12px] leading-5 text-[#86868b]">{waitingCopy(request, shares.length)}</p>
              </div>
            )}
          </div>
        )}

        <footer className="mt-16 border-t border-black/8 pt-5 text-center text-[11px] text-[#a1a1a6]">
          <p>Lyfos · <a href="/legal/privacy.html" className="underline">Privacy</a> · <a href="/legal/terms.html" className="underline">Terms</a></p>
        </footer>
      </div>
    </main>
  );
}

function Status({ request, sharesCount }) {
  const timeline = nomineeReleaseTimeline(request, sharesCount);
  return (
    <div className="rounded-2xl border border-black/8 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#86868b]">Current state</p>
          <p className="mt-1 text-[14px] font-medium capitalize">{request.state.replace(/_/g, " ")}</p>
        </div>
        <p className="rounded-full bg-[#f5f5f7] px-3 py-1 text-[11px] font-semibold text-[#6e6e73]">{sharesCount}/3 keys</p>
      </div>
      <div className="mt-5 space-y-3">
        {timeline.map((step) => (
          <div key={step.id} className="flex gap-3">
            <span className={"mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] font-semibold " + (
              step.status === "done" ? "border-[#1f9d55] bg-[#1f9d55] text-white"
              : step.status === "active" ? "border-[#1d1d1f] bg-[#1d1d1f] text-white"
              : "border-black/10 bg-[#f5f5f7] text-[#a1a1a6]"
            )}>
              {step.status === "done" ? "✓" : ""}
            </span>
            <div>
              <p className="text-[13px] font-semibold text-[#1d1d1f]">{step.title}</p>
              <p className="mt-0.5 text-[12px] leading-5 text-[#86868b]">{step.detail}</p>
            </div>
          </div>
        ))}
      </div>
      {request.state === "ready_to_release" && sharesCount >= 3 && (
        <p className="mt-5 rounded-xl bg-[#34c759]/10 px-4 py-3 text-[12px] font-medium text-[#0b6b3a]">
          The release is ready on this device. Download before closing this browser session.
        </p>
      )}
    </div>
  );
}

function waitingCopy(request, sharesCount) {
  if (request.state === "pending_review") return "Lyfos is reviewing the death certificate. Check back in a few hours.";
  if (request.state === "approved") return "The claim is approved. Your owner's key holders are being notified to release their shares.";
  if (request.state === "awaiting_shares") return `${sharesCount} of 3 minimum shares released. Waiting for the rest.`;
  if (request.state === "holding") return "Three shares released. The 14-day owner-protection hold is now active.";
  if (request.state === "cancelled") return "Your owner aborted this release. The vault is sealed.";
  if (request.state === "rejected") return `Your claim was rejected: ${request.rejection_reason ?? "no reason given"}.`;
  if (request.state === "completed") return "This release has already been completed.";
  return "Waiting…";
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
