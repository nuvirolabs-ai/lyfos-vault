// @scure/bip39 ships the wordlist files but its package.json `exports` map
// doesn't list the `./wordlists/english` subpath, so TypeScript's bundler-mode
// resolution can't find types for it (Metro still resolves the file fine at
// runtime). Declare the module so the typecheck stays clean.
declare module "@scure/bip39/wordlists/english" {
  export const wordlist: string[];
}
