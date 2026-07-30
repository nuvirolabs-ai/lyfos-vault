// AuthScreen — sign in / sign up / magic link. Apple-minimal, single
// column, matches the Home aesthetic.
//
// This screen is only rendered when:
//   - Supabase is configured (VITE_SUPABASE_URL set), AND
//   - There is no local vault yet (fresh install), AND
//   - The user has no active session.
//
// Existing localStorage-only users with a vault land directly on
// EntryScreen as before — they connect their account later via Settings.

import React, { useState } from "react";
import {
  signInWithPassword,
  signUpWithPassword,
  signInWithMagicLink,
  resetPasswordEmail,
  ensureDeviceToken
} from "./lib/auth.js";

const MIN_PASSWORD = 12;

export function AuthScreen({ onSignedIn, onContinueLocalOnly, onNomineeEntry }) {
  const [mode, setMode] = useState("signin"); // signin | signup | magic
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  ensureDeviceToken(); // make sure we have a stable device id before any sign-in

  async function submit(event) {
    event.preventDefault();
    setError("");
    setInfo("");
    setBusy(true);
    try {
      if (mode === "signin") {
        const data = await signInWithPassword({ email: email.trim(), password });
        if (data?.session) onSignedIn?.(data.session);
      } else if (mode === "signup") {
        if (password.length < MIN_PASSWORD) {
          throw new Error(`Account password must be at least ${MIN_PASSWORD} characters. This is separate from your vault passphrase.`);
        }
        const data = await signUpWithPassword({ email: email.trim(), password });
        if (data?.session) {
          onSignedIn?.(data.session);
        } else {
          setInfo(`Check your email — we sent a confirmation link to ${email}. Click it to finish setting up your account.`);
        }
      } else if (mode === "magic") {
        await signInWithMagicLink({ email: email.trim() });
        setInfo(`Sent a sign-in link to ${email}. Open it on this device to continue.`);
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
      await resetPasswordEmail({ email: email.trim() });
      setInfo(`Sent a password-reset link to ${email}.`);
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
          <h1 className="mt-4 text-[36px] font-semibold leading-[1.1] tracking-tight md:text-[44px]">
            {mode === "signup" ? "Create your account." : "Welcome back."}
          </h1>
          <p className="mx-auto mt-4 max-w-sm text-[14px] leading-6 text-[#6e6e73]">
            {mode === "signup"
              ? "Your account lets you open your vault on more than one device. Lyfos never sees your vault contents."
              : "Sign in to sync your vault across devices. Your encrypted vault stays unreadable to Lyfos."}
          </p>
        </header>

        <div className="mt-10 flex justify-center">
          <div className="inline-flex items-center gap-1 rounded-full border border-black/8 bg-white p-1 shadow-[0_2px_10px_rgba(0,0,0,0.03)]">
            {[
              ["signin", "Sign in"],
              ["signup", "Sign up"],
              ["magic",  "Magic link"]
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => { setMode(id); setError(""); setInfo(""); }}
                className={"rounded-full px-4 py-1.5 text-[12px] font-semibold transition " + (mode === id ? "bg-[#1d1d1f] text-white" : "text-[#6e6e73] hover:text-[#1d1d1f]")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={submit} className="mt-10 space-y-3">
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#86868b]">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="mt-2 w-full rounded-xl border border-black/8 bg-white px-4 py-3 text-[15px] outline-none transition focus:border-[#1d1d1f]"
            />
          </label>

          {mode !== "magic" && (
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#86868b]">
                {mode === "signup" ? `Account password (min ${MIN_PASSWORD} chars)` : "Account password"}
              </span>
              <input
                type="password"
                required
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-2 w-full rounded-xl border border-black/8 bg-white px-4 py-3 text-[15px] outline-none transition focus:border-[#1d1d1f]"
              />
            </label>
          )}

          {error && <div className="rounded-xl bg-[#ff453a]/8 px-4 py-3 text-[13px] font-medium text-[#b42318]">{error}</div>}
          {info  && <div className="rounded-xl bg-[#34c759]/10 px-4 py-3 text-[13px] font-medium text-[#0b6b3a]">{info}</div>}

          <button
            type="submit"
            disabled={busy || !email}
            className="mt-2 w-full rounded-full bg-[#1d1d1f] px-5 py-3 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy
              ? "Working…"
              : mode === "signin" ? "Sign in"
              : mode === "signup" ? "Create account"
              : "Email me a link"}
          </button>
        </form>

        {mode === "signin" && (
          <button onClick={sendReset} disabled={busy} className="mt-4 text-center text-[12px] text-[#86868b] hover:text-[#1d1d1f]">
            Forgot your password? · Send reset link
          </button>
        )}

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
            <p className="mt-2 text-[11px] text-[#a1a1a6]">Use this if someone shared a Lyfos claim link with you.</p>
          </div>
        )}

        <footer className="mt-auto pt-8 text-center text-[11px] text-[#a1a1a6]">
          <p>
            By continuing you agree to the{" "}
            <a href="/legal/terms.html" className="underline">Terms</a>,{" "}
            <a href="/legal/privacy.html" className="underline">Privacy</a> and{" "}
            <a href="/legal/beta-disclaimer.html" className="underline">Beta disclaimer</a>.
          </p>
          <p className="mt-3">Lyfos · Beta · Locally encrypted on this device.</p>
        </footer>
      </div>
    </main>
  );
}

function humanizeAuthError(err) {
  const raw = err?.message || String(err) || "Something went wrong.";
  if (raw.includes("Invalid login credentials")) return "That email and password don't match an account.";
  if (raw.includes("User already registered")) return "An account already exists for this email. Try signing in instead.";
  if (raw.toLowerCase().includes("rate limit")) return "Too many attempts. Wait a minute and try again.";
  if (raw.toLowerCase().includes("not configured")) return "Auth is not set up on this deployment. Use 'Continue without an account' for now.";
  return raw;
}
