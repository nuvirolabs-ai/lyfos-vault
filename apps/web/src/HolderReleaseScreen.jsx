// Lyfos — key holder release-share UI.
//
// Reachable at /hold-release. When a key holder signs in, if there are
// any release_requests where she's a verified holder + the state is
// approved/awaiting_shares/holding + she hasn't released yet — they
// appear here.
//
// Per-request flow:
//   1. She sees who's claiming, what state the request is in.
//   2. She types her passphrase (same one she used at invite-accept).
//   3. The app derives her release keypair, unwraps her share, and
//      re-encrypts it to the nominee's release_process_pubkey.
//   4. release_supporting_share inserts the row and advances state
//      to 'holding' when the second independent supporting share arrives.
//
// We deliberately keep this its own screen so the holder UX is
// distinct from the owner UX. A key holder may have her own Lyfos
// vault too — the role is independent.

import React, { useEffect, useState } from "react";
import { AuthScreen } from "./AuthScreen.jsx";
import { getSession, onAuthStateChange, signOut } from "./lib/auth.js";
import { listReleasesAwaitingMyAction, releaseMyShare } from "./lib/releasePlan.js";

export function HolderReleaseScreen({ onReturnHome }) {
  const [session, setSession] = useState(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
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

  async function refresh() {
    if (!session) return;
    setLoading(true);
    setError("");
    try {
      setItems(await listReleasesAwaitingMyAction());
    } catch (err) {
      setError(err?.message || "Couldn't load.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, [session?.user?.id]);

  if (!sessionLoaded) return <main className="min-h-screen bg-[#fbfbfd]" aria-hidden="true" />;

  if (!session) {
    return (
      <div>
        <div className="mx-auto max-w-md px-5 pt-12 text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#86868b]">Key holder release</p>
          <h1 className="mt-3 text-[28px] font-semibold leading-tight tracking-tight">Sign in to act on a release.</h1>
        </div>
        <div className="mt-6">
          <AuthScreen onSignedIn={(s) => setSession(s)} />
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#fbfbfd] text-[#1d1d1f]">
      <div className="mx-auto max-w-2xl px-5 py-10">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#86868b]">Lyfos · Key holder</p>
            <h1 className="mt-1 text-[28px] font-semibold tracking-tight">Help open a family vault</h1>
          </div>
          <button onClick={() => signOut().then(() => setSession(null))} className="text-[12px] text-[#86868b] hover:text-[#1d1d1f]">Sign out</button>
        </div>

        {error && <div className="mt-6 rounded-xl bg-[#ff453a]/8 px-4 py-3 text-[13px] font-medium text-[#b42318]">{error}</div>}

        {loading && <p className="mt-8 text-[14px] text-[#86868b]">Loading…</p>}

        {!loading && items.length === 0 && (
          <div className="mt-10 rounded-2xl border border-dashed border-black/12 bg-white p-8 text-center">
            <p className="text-[15px] font-medium text-[#1d1d1f]">Nothing to do.</p>
            <p className="mt-1 text-[12px] text-[#86868b]">If someone you keep a key for files a release claim, it'll appear here.</p>
            <button onClick={onReturnHome} className="mt-6 rounded-full bg-[#1d1d1f] px-5 py-2 text-[12px] font-semibold text-white">Go to Lyfos</button>
          </div>
        )}

        <div className="mt-8 space-y-3">
          {items.map((req) => <HolderReleaseCard key={req.id} req={req} onChanged={refresh} session={session} />)}
        </div>

        <footer className="mt-16 border-t border-black/8 pt-5 text-center text-[11px] text-[#a1a1a6]">
          <p>Lyfos · <a href="/legal/privacy.html" className="underline">Privacy</a> · <a href="/legal/terms.html" className="underline">Terms</a></p>
        </footer>
      </div>
    </main>
  );
}

function HolderReleaseCard({ req, onChanged, session }) {
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const recipientGated = Boolean(req.recipient_holder_id);
  const required = recipientGated ? 2 : 3;
  const received = (req.holderContext ?? []).filter((holder) => holder.share_released).length;
  const isRecipient = req.myHolderId === req.recipient_holder_id;

  if (req.iAlreadyReleased) {
    return (
      <div className="rounded-2xl border border-[#34c759]/30 bg-[#34c759]/8 p-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#0b6b3a]">You released — thank you</p>
        <p className="mt-1 text-[14px] font-medium">{req.myLabel}</p>
        <p className="mt-2 text-[12px] leading-5 text-[#6e6e73]">
          Filed by: {req.nominee_email_at_request}. The request is now {req.state.replaceAll("_", " ")}. The owner-protection hold runs only after two supporting keys match.
        </p>
      </div>
    );
  }

  if (isRecipient || (recipientGated && req.state !== "collecting_support")) {
    return (
      <div className="rounded-2xl border border-black/8 bg-white p-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#86868b]">No action needed</p>
        <p className="mt-2 text-[14px] font-medium">{isRecipient ? "You are the recovery recipient." : "The supporting-key stage has ended."}</p>
        <p className="mt-2 text-[12px] leading-5 text-[#6e6e73]">{received} of {required} supporting keys matched. A recipient's own share never counts as support.</p>
      </div>
    );
  }

  async function release() {
    if (!passphrase || passphrase.length < 12) { setError("Type the same passphrase you used at invite-accept."); return; }
    setBusy(true);
    setError("");
    try {
      await releaseMyShare({
        requestId: req.id,
        holderId: req.myHolderId,
        ownerId: req.owner_id,
        recipientPubkey: req.recipientPubkey,
        recipientGated,
        passphrase,
        holderUserId: session.user.id
      });
      setDone(true);
      await onChanged();
    } catch (err) {
      setError(err?.message || "Couldn't release.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-[#34c759]/30 bg-[#34c759]/8 p-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#0b6b3a]">Released</p>
        <p className="mt-1 text-[14px] font-medium">{req.myLabel}</p>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-[#c88719]/30 bg-[#fff8eb] p-6 md:p-7">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#7a4b00]">Someone else's vault</p>
      <h3 className="mt-2 text-[24px] font-semibold tracking-tight">You are helping open a family vault.</h3>
      <p className="mt-3 text-[13px] leading-5 text-[#7a4b00]">
        A recovery request was filed by <strong>{req.nominee_email_at_request}</strong>. It cannot open with the recipient's key alone: two other nominees must release their shares.
      </p>

      <div className="mt-6 rounded-2xl border border-[#c88719]/20 bg-white/70 p-4">
        <div className="flex items-baseline justify-between gap-4"><p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#7a4b00]">Supporting keys</p><strong className="text-[14px] text-[#7a4b00]">{received} of {required} required</strong></div>
        <div className="mt-4 grid grid-cols-2 gap-2.5 md:grid-cols-5">
          {(req.holderContext ?? []).map((holder) => {
            const isMine = holder.holder_id === req.myHolderId;
            const released = holder.share_released;
            const isRecoveryRecipient = holder.holder_id === req.recipient_holder_id;
            return <div key={holder.holder_id} className={`min-h-[82px] rounded-xl border p-3 ${isMine ? "border-[#1d1d1f] bg-white" : "border-black/8 bg-white/70"}`}><div className="text-[13px] font-semibold text-[#1d1d1f]">{holder.holder_label}</div><div className={`mt-2 text-[11px] ${released ? "text-[#0b6b3a]" : isMine ? "font-semibold text-[#7a4b00]" : "text-[#86868b]"}`}>{isRecoveryRecipient ? "Recipient" : released ? "Key received" : isMine ? "Your key" : "Waiting"}</div></div>;
          })}
        </div>
      </div>

      <p className="mt-5 text-[12px] leading-5 text-[#7a4b00]/85">Release only if you independently trust this request. Your share is re-encrypted to the selected recipient on this device. The vault stays sealed until a second supporting share arrives, then the owner-protection hold begins.</p>

      <label className="mt-4 block">
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#7a4b00]">Your release passphrase</span>
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          autoComplete="current-password"
          className="mt-1 w-full rounded-md border border-black/10 bg-white px-3 py-2 text-[13px] outline-none focus:border-[#1d1d1f]"
          placeholder="Same passphrase as at invite-accept"
        />
      </label>

      {error && <div className="mt-3 rounded-md bg-[#ff453a]/8 px-3 py-2 text-[12px] font-medium text-[#b42318]">{error}</div>}

      <div className="mt-4 flex items-center justify-end">
        <button
          onClick={release}
          disabled={busy || passphrase.length < 12}
          className="rounded-full bg-[#1d1d1f] px-5 py-2 text-[12px] font-semibold text-white shadow-[0_4px_12px_rgba(0,0,0,0.15)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Releasing…" : "Release my share"}
        </button>
      </div>
    </div>
  );
}
