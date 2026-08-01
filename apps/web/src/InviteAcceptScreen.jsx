// Lyfos — invite acceptance landing page.
//
// Flow:
//   1. Holder lands on /invite/:token. We peek the invite (no auth
//      needed) and render context: who invited her + her label.
//   2. She signs in or creates an account using the email the invite
//      was addressed to. Server-side accept_invite() enforces email match.
//   3. After auth, she types her vault passphrase. We derive the
//      Curve25519 release keypair from it and upload only the public
//      half via accept_invite().
//   4. Done — she sees a confirmation, and is told what happens next
//      (the owner will provision her share, then she'll be "verified").
//
// We deliberately keep the screen narrow in scope. A new Lyfos account
// can be created here (sign-up), but the holder's own vault setup is
// not gated through this screen — she can do that later by going to /.

import React, { useEffect, useState } from "react";
import { AuthScreen } from "./AuthScreen.jsx";
import { getSession, onAuthStateChange, signOut } from "./lib/auth.js";
import { peekInvite, acceptInvite } from "./lib/releasePlan.js";
import { deriveHolderKeypairFromPassphrase } from "./lib/shareCrypto.js";

export function InviteAcceptScreen({ token, onReturnHome }) {
  const [invite, setInvite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [session, setSession] = useState(null);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // Load invite context once
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    peekInvite(token)
      .then((row) => { if (!cancelled) setInvite(row ?? null); })
      .catch((err) => { if (!cancelled) setError(err?.message ?? "Couldn't load invite."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  // Track sign-in state
  useEffect(() => {
    let cancelled = false;
    getSession().then((s) => { if (!cancelled) setSession(s); }).catch(() => {});
    const unsubscribe = onAuthStateChange((next) => { if (!cancelled) setSession(next); });
    return () => { cancelled = true; unsubscribe(); };
  }, []);

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!session?.user?.id) {
      setError("Sign in first.");
      return;
    }
    if (passphrase.length < 12) {
      setError("Use the same passphrase you use to open your own Lyfos vault. Must be at least 12 characters.");
      return;
    }
    setBusy(true);
    try {
      const kp = await deriveHolderKeypairFromPassphrase(passphrase, session.user.id);
      await acceptInvite({ token, releasePubkey: kp.publicKey });
      setDone(true);
      // SecretKey is intentionally discarded — re-derived on demand at release time.
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <main className="min-h-screen bg-[#fbfbfd]" aria-hidden="true" />;
  }

  if (error && !invite) {
    return (
      <Frame>
        <h1 className="text-[28px] font-semibold tracking-tight">Invite not available.</h1>
        <p className="mt-3 text-[14px] text-[#6e6e73]">{error}</p>
        <p className="mt-6 text-[12px] text-[#86868b]">
          The invite may have been revoked, or the link is wrong. Ask the person who invited you to resend it.
        </p>
        <button onClick={onReturnHome} className="mt-8 rounded-full border border-black/8 bg-white px-5 py-2 text-[12px] font-semibold text-[#1d1d1f]">Go to Lyfos</button>
      </Frame>
    );
  }

  if (!invite) {
    return (
      <Frame>
        <h1 className="text-[28px] font-semibold tracking-tight">This invite is no longer valid.</h1>
        <p className="mt-3 text-[14px] text-[#6e6e73]">It may have been revoked or already used.</p>
        <button onClick={onReturnHome} className="mt-8 rounded-full border border-black/8 bg-white px-5 py-2 text-[12px] font-semibold text-[#1d1d1f]">Go to Lyfos</button>
      </Frame>
    );
  }

  if (done) {
    return (
      <Frame>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#0b6b3a]">Accepted</p>
        <h1 className="mt-3 text-[32px] font-semibold leading-tight tracking-tight">You hold a key.</h1>
        <p className="mt-5 max-w-md text-[14px] leading-6 text-[#6e6e73]">
          {invite.owner_email.split("@")[0]} has been notified. When they finalize their circle, Lyfos will seal one encrypted share of their vault key to your account. No plain key is shown, emailed, or stored.
        </p>
        <p className="mt-3 max-w-md text-[14px] leading-6 text-[#6e6e73]">
          You can see this relationship later in <strong>Settings → Keys you hold</strong>. After finalization, your status moves from "Accepted" to "Verified".
        </p>
        <p className="mt-3 max-w-md text-[14px] leading-6 text-[#6e6e73]">
          If they ever need to release the vault — death or incapacity — you'll get an email and a notification with one tap to approve or refuse.
        </p>
        <button onClick={onReturnHome} className="mt-10 rounded-full bg-[#1d1d1f] px-7 py-3 text-sm font-semibold text-white">Open Lyfos</button>
      </Frame>
    );
  }

  // Already signed in but wrong email
  if (session && invite && session.user?.email && session.user.email.toLowerCase() !== invite.holder_email.toLowerCase()) {
    return (
      <Frame>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#86868b]">Wrong account</p>
        <h1 className="mt-3 text-[28px] font-semibold leading-tight tracking-tight">Sign in as {invite.holder_email}</h1>
        <p className="mt-4 max-w-md text-[14px] leading-6 text-[#6e6e73]">
          You're signed in as <strong>{session.user.email}</strong>. This invite was sent to <strong>{invite.holder_email}</strong> — sign out and try again with that email.
        </p>
        <button onClick={() => signOut()} className="mt-8 rounded-full bg-[#1d1d1f] px-6 py-2.5 text-sm font-semibold text-white">Sign out</button>
      </Frame>
    );
  }

  // Not signed in yet — render the AuthScreen but pre-explain the context
  if (!session) {
    return (
      <div>
        <div className="mx-auto max-w-md px-5 pt-12 text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#86868b]">Key holder invite</p>
          <h1 className="mt-3 text-[28px] font-semibold leading-tight tracking-tight">
            {invite.owner_email.split("@")[0]} invited you.
          </h1>
          <p className="mt-4 text-[14px] leading-6 text-[#6e6e73]">
            Label: <strong>{invite.label}</strong>
          </p>
          <p className="mt-4 text-[13px] leading-5 text-[#86868b]">
            Sign in or create your Lyfos account using <strong>{invite.holder_email}</strong> to continue. Three of five trusted nominees/key holders are required for a release; you'd be one of them.
          </p>
        </div>
        <div className="mt-6">
          <AuthScreen onSignedIn={(s) => setSession(s)} />
        </div>
      </div>
    );
  }

  // Signed in with the matching email — show the passphrase prompt
  return (
    <Frame>
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#86868b]">Step 2 of 2</p>
      <h1 className="mt-3 text-[28px] font-semibold leading-tight tracking-tight">
        Set up your release key.
      </h1>
      <p className="mt-4 text-[14px] leading-6 text-[#6e6e73]">
        Type the passphrase you use (or will use) to open your own Lyfos vault. We use it on this device to create your release keypair — Lyfos never sees the passphrase or a raw key.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-3">
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#86868b]">Your vault passphrase</span>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            className="mt-2 w-full rounded-xl border border-black/8 bg-white px-4 py-3 text-[15px] outline-none transition focus:border-[#1d1d1f]"
            placeholder="Minimum 12 characters"
          />
        </label>

        <p className="rounded-xl bg-[#fff8eb] px-4 py-3 text-[12px] leading-5 text-[#7a4b00]">
          <strong>Remember this passphrase.</strong> If you forget it, you cannot release {invite.owner_email.split("@")[0]}'s vault when needed. Lyfos cannot recover it for you.
        </p>

        {error && <div className="rounded-xl bg-[#ff453a]/8 px-4 py-3 text-[13px] font-medium text-[#b42318]">{error}</div>}

        <button
          type="submit"
          disabled={busy || passphrase.length < 12}
          className="mt-2 w-full rounded-full bg-[#1d1d1f] px-5 py-3 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Working…" : "Accept invite"}
        </button>
      </form>

      <button onClick={() => signOut().then(() => setSession(null))} className="mt-6 text-[12px] text-[#86868b] hover:text-[#1d1d1f]">
        Use a different account
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

function humanizeError(err) {
  const raw = err?.message || String(err) || "Something went wrong.";
  if (/email/i.test(raw) && /sent/i.test(raw)) return raw;
  if (raw.includes("sign in with the email")) return raw;
  if (raw.toLowerCase().includes("not authenticated")) return "Sign in first.";
  return raw;
}
