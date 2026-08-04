// AuthScreen — single, simple flow: type your email and password and
// press Continue. No separate sign-in/sign-up/magic-link tabs to
// choose between first — we try to sign you in, and if there's no
// matching account yet we offer to create one with the same details
// you just typed. Apple-minimal, single column.
//
// This screen is only rendered when:
//   - Supabase is configured (VITE_SUPABASE_URL set), AND
//   - There is no local vault yet (fresh install), AND
//   - The user has no active session.
//
// Existing localStorage-only users with a vault land directly on
// EntryScreen as before — they connect their account later via Settings.

import React, { useEffect, useState } from "react";
import {
  signInWithPassword,
  signUpWithPassword,
  signInWithMagicLink,
  resetPasswordEmail,
  resendSignupConfirmation,
  ensureDeviceToken
} from "./lib/auth.js";

const MIN_PASSWORD = 12;

export function AuthScreen({
  onSignedIn,
  onContinueLocalOnly,
  onNomineeEntry,
  initialEmail = "",
  lockedEmail = false,
  returnPath = "/",
  title = "Sign in or create your account.",
  subtitle = "One email, one password. Your account lets you open your vault on more than one device — Lyfos never sees your vault contents."
}) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [offerCreateAccount, setOfferCreateAccount] = useState(false);
  const [activationPending, setActivationPending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [magicSent, setMagicSent] = useState(false);

  ensureDeviceToken(); // make sure we have a stable device id before any sign-in

  useEffect(() => {
    if (resendCooldown <= 0) return undefined;
    const timer = window.setInterval(() => setResendCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown > 0]);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setInfo("");
    setOfferCreateAccount(false);
    setBusy(true);
    try {
      const data = await signInWithPassword({ email: email.trim(), password });
      if (data?.session) onSignedIn?.(data.session);
    } catch (err) {
      if (isInvalidCredentials(err)) {
        setOfferCreateAccount(true);
        setInfo("We couldn't find a matching account. New here? Create one with the same email and password below.");
      } else {
        setError(humanizeAuthError(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function createAccount() {
    setError("");
    setInfo("");
    if (password.length < MIN_PASSWORD) {
      setError(`Account password must be at least ${MIN_PASSWORD} characters. This is separate from your vault passphrase.`);
      return;
    }
    setBusy(true);
    try {
      const data = await signUpWithPassword({ email: email.trim(), password, returnPath });
      if (data?.session) {
        onSignedIn?.(data.session);
      } else {
        setOfferCreateAccount(false);
        setActivationPending(true);
        setResendCooldown(60);
        setInfo(`Check your email — we sent a confirmation link to ${email}. Click it to finish setting up your account.`);
      }
    } catch (err) {
      setError(humanizeAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendReset() {
    setError("");
    setInfo("");
    if (!email.trim()) {
      setError("Enter your email above, then click Send reset link.");
      return;
    }
    setBusy(true);
    try {
      await resetPasswordEmail({ email: email.trim(), returnPath });
      setInfo(`Sent a password-reset link to ${email}.`);
    } catch (err) {
      setError(humanizeAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendMagicLink() {
    setError("");
    setInfo("");
    if (!email.trim()) {
      setError("Enter your email above first.");
      return;
    }
    setBusy(true);
    try {
      await signInWithMagicLink({ email: email.trim(), returnPath });
      setMagicSent(true);
      setInfo(`Sent a sign-in link to ${email}. Open it on this device to continue.`);
    } catch (err) {
      setError(humanizeAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  async function resendActivation() {
    setError("");
    setBusy(true);
    try {
      await resendSignupConfirmation({ email: email.trim(), returnPath });
      setResendCooldown(60);
      setInfo(`A fresh confirmation link is on its way to ${email}.`);
    } catch (err) {
      setError(humanizeAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#fbfbfd] text-[#1d1d1f]">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 py-12">
        <header className="text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#86868b]">Lyfos</p>
          <h1 className="mt-4 text-[36px] font-semibold leading-[1.1] tracking-tight md:text-[44px]">{title}</h1>
          {subtitle && (
            <p className="mx-auto mt-4 max-w-sm text-[14px] leading-6 text-[#6e6e73]">
              {subtitle}
            </p>
          )}
        </header>

        <form onSubmit={submit} className="mt-10 space-y-3">
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#86868b]">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => { setEmail(e.target.value); setOfferCreateAccount(false); }}
              disabled={lockedEmail}
              placeholder="you@example.com"
              className="mt-2 w-full rounded-xl border border-black/8 bg-white px-4 py-3 text-[15px] outline-none transition focus:border-[#1d1d1f] disabled:bg-[#f5f5f7] disabled:text-[#6e6e73]"
            />
          </label>

          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#86868b]">Password</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setOfferCreateAccount(false); }}
              className="mt-2 w-full rounded-xl border border-black/8 bg-white px-4 py-3 text-[15px] outline-none transition focus:border-[#1d1d1f]"
            />
          </label>

          {error && <div className="rounded-xl bg-[#ff453a]/8 px-4 py-3 text-[13px] font-medium text-[#b42318]">{error}</div>}
          {info  && <div className="rounded-xl bg-[#34c759]/10 px-4 py-3 text-[13px] font-medium text-[#0b6b3a]">{info}</div>}

          <button
            type="submit"
            disabled={busy || !email || !password}
            className="mt-2 w-full rounded-full bg-[#1d1d1f] px-5 py-3 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Working…" : "Continue"}
          </button>

          {offerCreateAccount && (
            <button
              type="button"
              onClick={createAccount}
              disabled={busy}
              className="w-full rounded-full border border-black/8 bg-white px-5 py-3 text-sm font-semibold text-[#1d1d1f] transition hover:bg-[#f5f5f7] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Create account with this email and password
            </button>
          )}
        </form>

        {activationPending && (
          <button
            type="button"
            onClick={resendActivation}
            disabled={busy || resendCooldown > 0}
            className="mt-4 text-center text-[12px] font-medium text-[#6e6e73] hover:text-[#1d1d1f] disabled:text-[#a1a1a6]"
          >
            {resendCooldown > 0 ? `Resend available in ${resendCooldown}s` : "Resend activation email"}
          </button>
        )}

        <div className="mt-5 flex items-center justify-center gap-4">
          <button onClick={sendReset} disabled={busy} className="text-center text-[12px] text-[#86868b] hover:text-[#1d1d1f]">
            Forgot password?
          </button>
          <span className="text-[12px] text-[#d2d2d7]">·</span>
          <button onClick={sendMagicLink} disabled={busy || magicSent} className="text-center text-[12px] text-[#86868b] hover:text-[#1d1d1f] disabled:text-[#a1a1a6]">
            {magicSent ? "Link sent" : "Email me a link instead"}
          </button>
        </div>

        {onContinueLocalOnly && (
          <div className="mt-12 border-t border-black/8 pt-6 text-center">
            <button onClick={onContinueLocalOnly} className="text-[12px] text-[#86868b] hover:text-[#1d1d1f]">
              Or continue without an account · this device only
            </button>
            <p className="mt-2 text-[11px] text-[#a1a1a6]">
              Your vault will stay encrypted on this browser only. You can connect an account later.
            </p>
          </div>
        )}

        {onNomineeEntry && (
          <div className={(onContinueLocalOnly ? "mt-5" : "mt-12 border-t border-black/8 pt-6") + " text-center"}>
            <button onClick={onNomineeEntry} className="rounded-full border border-black/8 bg-white px-4 py-2 text-[12px] font-semibold text-[#1d1d1f] transition hover:bg-[#f5f5f7]">
              I am a nominee
            </button>
            <p className="mt-2 text-[11px] text-[#a1a1a6]">Sign in to review vaults entrusted to your account.</p>
          </div>
        )}

        <footer className="mt-auto pt-8 text-center text-[11px] text-[#a1a1a6]">
          <p>
            By continuing you agree to the{" "}
            <a href="/legal/terms.html" className="underline">Terms</a>,{" "}
            <a href="/legal/privacy.html" className="underline">Privacy</a> and{" "}
            <a href="/legal/product-disclaimer.html" className="underline">Product disclaimer</a>.
          </p>
          <p className="mt-3">Lyfos · Locally encrypted on this device.</p>
        </footer>
      </div>
    </main>
  );
}

export function isInvalidCredentials(err) {
  const raw = err?.message || String(err) || "";
  return raw.includes("Invalid login credentials");
}

export function humanizeAuthError(err) {
  const raw = err?.message || String(err) || "Something went wrong.";
  if (raw.includes("Invalid login credentials")) return "That email and password don't match an account.";
  if (raw.includes("User already registered")) return "An account already exists for this email. Enter the matching password above to sign in.";
  if (raw.toLowerCase().includes("rate limit")) return "Too many attempts. Wait a minute and try again.";
  if (raw.toLowerCase().includes("not configured")) return "Auth is not set up on this deployment. Use 'Continue without an account' for now.";
  return raw;
}
