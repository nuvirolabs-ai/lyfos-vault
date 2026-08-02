// Lyfos — release claim landing page.
//
// Reachable at /claim/:token. A nominee whom an owner has shared the
// link with lands here.
//
// Flow:
//   1. Peek the claim (no auth) → render context (owner email, plan-active,
//      optional owner-written claim_text, expected nominee email).
//   2. Sign-in / sign-up gate (re-uses AuthScreen).
//   3. After auth: upload the death certificate file → Supabase Storage.
//   4. Generate a fresh release_process Curve25519 keypair, store the
//      secret half locally for the duration of this browser session
//      under a sessionStorage key, upload only the public half to the
//      release_requests row via create_release_request RPC.
//   5. Confirmation screen with what happens next (admin review, holders
//      will be alerted, 14-day hold).
//
// We deliberately do NOT prompt the nominee for a "release passphrase"
// to derive a stable keypair. The Curve25519 keypair is fresh per claim
// and the secret is in sessionStorage; if the nominee loses access to
// this browser session before the release completes, she has to file
// a new claim (and we tell her so).

import React, { useEffect, useState } from "react";
import { AuthScreen } from "./AuthScreen.jsx";
import { getSession, onAuthStateChange, signOut } from "./lib/auth.js";
import { peekClaim, uploadDeathCertificate, createReleaseRequest } from "./lib/releaseClaim.js";
import { stashReleaseProcessKey } from "./lib/nomineeReleaseFlow.js";
import { makeReleaseProcessKeypair } from "./lib/shareCrypto.js";

export function ClaimScreen({ token, onReturnHome }) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [session, setSession] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [requestId, setRequestId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    peekClaim(token)
      .then((row) => { if (!cancelled) setInfo(row ?? null); })
      .catch((err) => { if (!cancelled) setLoadError(err?.message ?? "Couldn't load this claim link."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    getSession().then((s) => { if (!cancelled) setSession(s); }).catch(() => {});
    const unsubscribe = onAuthStateChange((next) => { if (!cancelled) setSession(next); });
    return () => { cancelled = true; unsubscribe(); };
  }, []);

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!session?.user?.id) { setError("Sign in first."); return; }
    if (!file) { setError("Attach the death certificate as a PDF or image."); return; }

    setBusy(true);
    try {
      // Generate a fresh per-claim keypair. SecretKey held in sessionStorage
      // so a reload during the same browser session can still combine
      // shares when the time comes.
      const kp = await makeReleaseProcessKeypair();
      stashReleaseProcessKey({ token, keypair: kp });

      const certPath = await uploadDeathCertificate(file);
      const id = await createReleaseRequest({
        claimToken: token,
        releaseProcessPubkey: kp.publicKey,
        deathCertificatePath: certPath
      });
      stashReleaseProcessKey({ token, requestId: id, keypair: kp });
      setRequestId(id);
      setDone(true);
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <main className="min-h-screen bg-[#fbfbfd]" aria-hidden="true" />;

  if (loadError && !info) return <FrameError message={loadError} onReturnHome={onReturnHome} />;
  if (!info) return <FrameError message="This claim link is no longer valid." onReturnHome={onReturnHome} />;
  if (!info.plan_active) {
    return (
      <Frame>
        <h1 className="text-[28px] font-semibold tracking-tight">Plan is not active yet.</h1>
        <p className="mt-3 text-[14px] text-[#6e6e73]">
          {info.owner_email.split("@")[0]} has shared this link with you but hasn't finalized their release plan. Ask them to invite their 5 key holders and finalize before you can file a claim.
        </p>
        <button onClick={onReturnHome} className="mt-8 rounded-full border border-black/8 bg-white px-5 py-2 text-[12px] font-semibold text-[#1d1d1f]">Go to Lyfos</button>
      </Frame>
    );
  }

  if (done) {
    return (
      <Frame>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#0b6b3a]">Filed</p>
        <h1 className="mt-3 text-[28px] font-semibold leading-tight tracking-tight">Your claim is in review.</h1>
        <p className="mt-5 text-[14px] leading-6 text-[#6e6e73]">
          A Lyfos founder will review the death certificate within 24 hours (often sooner). Once approved, {info.owner_email.split("@")[0]}'s 5 key holders will be asked to release their shares. After 3 of them do, a mandatory 14-day owner-protection hold begins during which {info.owner_email.split("@")[0]} is alerted daily and can abort.
        </p>
        <p className="mt-3 text-[14px] leading-6 text-[#6e6e73]">
          After the hold, you'll be able to download the emergency-eligible records from this same device. <strong>Keep this browser session open</strong> — your release process key is stored in this tab only.
        </p>
        <p className="mt-4 text-[12px] text-[#86868b]">Reference: <span className="font-mono">{requestId?.slice(0, 8)}…</span></p>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <button onClick={() => { window.location.assign("/download"); }} className="rounded-full bg-[#1d1d1f] px-7 py-3 text-sm font-semibold text-white">View release status</button>
          <button onClick={onReturnHome} className="rounded-full border border-black/8 bg-white px-7 py-3 text-sm font-semibold text-[#1d1d1f]">Done</button>
        </div>
      </Frame>
    );
  }

  if (!session) {
    return (
      <div>
        <div className="mx-auto max-w-md px-5 pt-12 text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#86868b]">Release claim</p>
          <h1 className="mt-3 text-[28px] font-semibold leading-tight tracking-tight">
            File a claim against {info.owner_email.split("@")[0]}'s vault.
          </h1>
          {info.nominee_email && (
            <p className="mt-4 text-[13px] text-[#86868b]">
              Sign in using <strong>{info.nominee_email}</strong> — the email {info.owner_email.split("@")[0]} expected for you.
            </p>
          )}
          {info.claim_text && (
            <p className="mx-auto mt-6 max-w-sm rounded-xl bg-white px-4 py-3 text-left text-[13px] leading-5 text-[#6e6e73]">
              <span className="block text-[10px] font-medium uppercase tracking-[0.14em] text-[#a1a1a6]">Note from {info.owner_email.split("@")[0]}</span>
              <span className="mt-1.5 block">{info.claim_text}</span>
            </p>
          )}
        </div>
        <div className="mt-6">
          <AuthScreen
            initialEmail={info.nominee_email ?? ""}
            lockedEmail={Boolean(info.nominee_email)}
            returnPath={`/claim/${token}`}
            onSignedIn={(s) => setSession(s)}
          />
        </div>
      </div>
    );
  }

  return (
    <Frame>
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#86868b]">Step 2 of 2</p>
      <h1 className="mt-3 text-[28px] font-semibold leading-tight tracking-tight">Upload proof of death or incapacity.</h1>
      <p className="mt-4 text-[14px] leading-6 text-[#6e6e73]">
        A Lyfos founder will manually review what you upload. We don't run automated identity verification — a real person reads each submission.
      </p>
      <p className="mt-3 text-[14px] leading-6 text-[#6e6e73]">
        Accepted: death certificate, hospital incapacity declaration, court order. PDF or image, up to 10 MB.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-3">
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#86868b]">Certificate file</span>
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-2 w-full rounded-xl border border-black/8 bg-white px-4 py-3 text-[13px] outline-none file:mr-3 file:rounded-md file:border-0 file:bg-[#1d1d1f] file:px-3 file:py-1.5 file:text-[12px] file:font-semibold file:text-white"
          />
          {file && <p className="mt-2 text-[11px] text-[#86868b]">{file.name} · {Math.round(file.size / 1024)} KB</p>}
        </label>

        <p className="rounded-xl bg-[#fff8eb] px-4 py-3 text-[12px] leading-5 text-[#7a4b00]">
          <strong>Filing a fraudulent claim is a crime.</strong> {info.owner_email.split("@")[0]} gets a daily alert for 14 days after 3 of their key holders release. If they are alive, they will see the alerts and abort — and you will be in trouble.
        </p>

        {error && <div className="rounded-xl bg-[#ff453a]/8 px-4 py-3 text-[13px] font-medium text-[#b42318]">{error}</div>}

        <button
          type="submit"
          disabled={busy || !file}
          className="mt-2 w-full rounded-full bg-[#1d1d1f] px-5 py-3 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Filing claim…" : "File claim"}
        </button>
      </form>

      <button onClick={() => signOut().then(() => setSession(null))} className="mt-6 text-[12px] text-[#86868b] hover:text-[#1d1d1f]">
        Sign out
      </button>
    </Frame>
  );
}

function Frame({ children }) {
  return (
    <main className="min-h-screen bg-[#fbfbfd] text-[#1d1d1f]">
      <div className="mx-auto max-w-md px-5 py-12">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#86868b]">Lyfos</p>
        <div className="mt-8">{children}</div>
        <footer className="mt-16 border-t border-black/8 pt-5 text-center text-[11px] text-[#a1a1a6]">
          <p>Lyfos · <a href="/legal/privacy.html" className="underline">Privacy</a> · <a href="/legal/terms.html" className="underline">Terms</a></p>
        </footer>
      </div>
    </main>
  );
}

function FrameError({ message, onReturnHome }) {
  return (
    <Frame>
      <h1 className="text-[28px] font-semibold tracking-tight">Couldn't load this claim link.</h1>
      <p className="mt-3 text-[14px] text-[#6e6e73]">{message}</p>
      <button onClick={onReturnHome} className="mt-8 rounded-full border border-black/8 bg-white px-5 py-2 text-[12px] font-semibold text-[#1d1d1f]">Go to Lyfos</button>
    </Frame>
  );
}

function humanizeError(err) {
  const raw = err?.message || String(err) || "Something went wrong.";
  if (raw.includes("already in flight")) return "There's already an active release request against this vault. Wait until it's resolved or cancelled.";
  if (raw.includes("you cannot file a claim against your own vault")) return "You can't file a release claim against your own account.";
  if (raw.includes("not finalized")) return raw;
  return raw;
}
