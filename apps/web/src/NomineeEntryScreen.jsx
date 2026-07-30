import React, { useState } from "react";
import { extractClaimToken } from "./lib/nomineeReleaseFlow.js";

export function NomineeEntryScreen({ onReturnHome }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  function submit(event) {
    event.preventDefault();
    const token = extractClaimToken(input);
    if (!token) {
      setError("Paste the claim link shared by the vault owner.");
      return;
    }
    window.location.assign(`/claim/${token}`);
  }

  return (
    <main className="min-h-screen bg-[#fbfbfd] text-[#1d1d1f]">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 py-12">
        <header className="text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#86868b]">Lyfos nominee</p>
          <h1 className="mt-4 text-[34px] font-semibold leading-[1.08] tracking-tight md:text-[42px]">
            Open a family vault request.
          </h1>
          <p className="mx-auto mt-4 max-w-sm text-[14px] leading-6 text-[#6e6e73]">
            Use the private claim link given by the vault owner. Lyfos will ask you to sign in only after the link is recognized.
          </p>
        </header>

        <form onSubmit={submit} className="mt-10 rounded-2xl border border-black/8 bg-white p-5 shadow-[0_14px_42px_rgba(0,0,0,0.05)]">
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#86868b]">Claim link or code</span>
            <input
              type="text"
              autoFocus
              value={input}
              onChange={(event) => { setInput(event.target.value); setError(""); }}
              placeholder="https://app.lyfos.in/claim/..."
              className="mt-2 h-[50px] w-full rounded-xl border border-black/8 bg-[#fbfbfd] px-4 text-[15px] outline-none transition focus:border-[#1d1d1f]"
            />
          </label>
          {error && <div className="mt-3 rounded-xl bg-[#ff453a]/8 px-4 py-3 text-[13px] font-medium text-[#b42318]">{error}</div>}
          <button
            type="submit"
            className="mt-4 h-[50px] w-full rounded-full bg-[#1d1d1f] text-sm font-semibold text-white shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition hover:bg-black"
          >
            Continue
          </button>
        </form>

        <div className="mt-8 rounded-2xl border border-black/8 bg-white px-5 py-4">
          <p className="text-[12px] font-semibold text-[#1d1d1f]">What happens next</p>
          <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[11px] text-[#86868b]">
            {["Sign in", "Upload proof", "3 keys", "14-day hold"].map((label) => (
              <div key={label} className="rounded-xl bg-[#f5f5f7] px-2 py-3">{label}</div>
            ))}
          </div>
        </div>

        <button onClick={onReturnHome} className="mt-8 text-center text-[12px] text-[#86868b] hover:text-[#1d1d1f]">
          Go to Lyfos
        </button>

        <footer className="mt-auto pt-8 text-center text-[11px] text-[#a1a1a6]">
          <p>Lyfos · <a href="/legal/privacy.html" className="underline">Privacy</a> · <a href="/legal/terms.html" className="underline">Terms</a></p>
        </footer>
      </div>
    </main>
  );
}
