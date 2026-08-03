// Best-effort clipboard scrub for secrets (recovery phrase, recovered
// vault values) — copies the value, then clears the clipboard after a
// timeout, but only if it still holds exactly what we put there (so we
// don't wipe something the user copied from elsewhere in the meantime).
// Non-sensitive copies (invite links, etc.) don't need this.
export async function copyToClipboardWithAutoClear(text, ms = 30000) {
  if (!text) return;
  await navigator.clipboard.writeText(text);
  setTimeout(async () => {
    try {
      if (navigator.clipboard.readText) {
        const current = await navigator.clipboard.readText();
        if (current !== text) return;
      }
      await navigator.clipboard.writeText("");
    } catch {
      // Clipboard read/write can be blocked (permissions, tab not focused)
      // — nothing more we can safely do here.
    }
  }, ms);
}
