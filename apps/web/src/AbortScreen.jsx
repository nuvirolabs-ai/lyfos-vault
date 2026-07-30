// Lyfos — one-tap release abort.
//
// Reachable at /release/abort. The owner gets here from any of her
// daily alerts. She must be signed in (we require it — a no-auth abort
// would let anyone with the URL kill someone's release request).
//
// The screen finds the in-flight release_request against her account
// and renders a single big "Abort" button + the days remaining. No
// other UI distractions; this is the panic-button page.

import React, { useEffect, useState } from "react";
import { AuthScreen } from "./AuthScreen.jsx";
import { getSession, onAuthStateChange } from "./lib/auth.js";
import { fetchActiveReleaseAgainstMe, ownerAbortRelease } from "./lib/releaseClaim.js";

export function AbortScreen({ onReturnHome }) {
  const [session, setSession] = useState(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

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

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setLoading(true);
    fetchActiveReleaseAgainstMe()
      .then((r) => { if (!cancelled) setRequest(r ?? null); })
      .catch((err) => { if (!cancelled) setError(err?.message || "Couldn't load."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  async function abort() {
    if (!request) return;
    setBusy(true);
    setError("");
    try {
      await ownerAbortRelease(request.id, "owner_abort_from_alert");
      setDone(true);
    } catch (err) {
      setError(err?.message || "Couldn't abort. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!sessionLoaded) return <main className="min-h-screen bg-[#fbfbfd]" aria-hidden="true" />;

  if (!session) {
    return (
      <div>
        <div className="mx-auto max-w-md px-5 pt-12 text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#b42318]">Release abort</p>
          <h1 className="mt-3 text-[32px] font-semibold leading-tight tracking-tight">Sign in to abort.</h1>
          <p className="mt-4 text-[14px] leading-6 text-[#6e6e73]">
            Once signed in you'll see one button. Tap it and your vault stays sealed.
          </p>
        </div>
        <div className="mt-6">
          <AuthScreen onSignedIn={(s) => setSession(s)} />
        </div>
      </div>
    );
  }

  if (loading) return <Frame><p className="text-[14px] text-[#6e6e73]">Loading…</p></Frame>;

  if (done) {
    return (
      <Frame>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#0b6b3a]">Aborted</p>
        <h1 className="mt-3 text-[32px] font-semibold tracking-tight">Your vault stays sealed.</h1>
        <p className="mt-4 text-[14px] leading-6 text-[#6e6e73]">
          The release request has been cancelled. Your nominee will be notified. Your key holders are off the hook.
        </p>
        <button onClick={onReturnHome} className="mt-10 rounded-full bg-[#1d1d1f] px-7 py-3 text-sm font-semibold text-white">
          Open Lyfos
        </button>
      </Frame>
    );
  }

  if (!request) {
    return (
      <Frame>
        <h1 className="text-[28px] font-semibold tracking-tight">No active release.</h1>
        <p className="mt-3 text-[14px] text-[#6e6e73]">
          Nothing in flight against your account right now. The alert that brought you here may have been an older one.
        </p>
        <button onClick={onReturnHome} className="mt-8 rounded-full bg-[#1d1d1f] px-5 py-2 text-[12px] font-semibold text-white">Go to Lyfos</button>
      </Frame>
    );
  }

  if (request.state === "ready_to_release" || request.state === "completed") {
    return (
      <Frame>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#b42318]">Too late</p>
        <h1 className="mt-3 text-[28px] font-semibold tracking-tight">The hold has expired.</h1>
        <p className="mt-3 text-[14px] text-[#6e6e73]">
          The 14-day window has passed; the release is now in your nominee's hands. If you believe this happened in error, email <a href="mailto:hello@lyfos.in" className="underline">hello@lyfos.in</a> immediately.
        </p>
      </Frame>
    );
  }

  const daysLeft = request.ready_at
    ? Math.max(0, Math.ceil((new Date(request.ready_at).getTime() - Date.now()) / 86_400_000))
    : null;

  return (
    <Frame>
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#b42318]">Active release</p>
      <h1 className="mt-3 text-[32px] font-semibold leading-tight tracking-tight">Are you alive?</h1>
      <p className="mt-4 text-[14px] leading-6 text-[#6e6e73]">
        Someone (<strong>{request.nominee_email_at_request}</strong>) filed a release of your vault. The hold expires in <strong>{daysLeft ?? "?"} day{daysLeft === 1 ? "" : "s"}</strong>.
      </p>
      <p className="mt-3 text-[14px] leading-6 text-[#6e6e73]">
        If you're reading this, abort right now. Your vault stays sealed. Your key holders are released. The claim is closed.
      </p>

      {error && <div className="mt-5 rounded-xl bg-[#ff453a]/8 px-4 py-3 text-[13px] font-medium text-[#b42318]">{error}</div>}

      <div className="mt-10 flex flex-col items-center">
        <button
          onClick={abort}
          disabled={busy}
          className="rounded-full bg-[#b42318] px-8 py-4 text-[16px] font-semibold text-white shadow-[0_10px_30px_rgba(180,35,24,0.3)] transition hover:bg-[#8e1612] disabled:opacity-40"
        >
          {busy ? "Aborting…" : "Abort — I'm fine"}
        </button>
        <p className="mt-4 text-[11px] text-[#a1a1a6]">One tap. Reversible only by filing a new claim.</p>
      </div>
    </Frame>
  );
}

function Frame({ children }) {
  return (
    <main className="min-h-screen bg-[#fbfbfd] text-[#1d1d1f]">
      <div className="mx-auto max-w-md px-5 py-12">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#86868b]">Lyfos</p>
        <div className="mt-8">{children}</div>
      </div>
    </main>
  );
}
