// Shim for the Node "crypto" builtin.
//
// secrets.js-grempe (our Shamir secret-sharing library) is a UMD
// module: `module.exports = factory(require("crypto"))`. Vite's
// bundler resolves that `require("crypto")` by externalizing the Node
// builtin for the browser, which produces an empty stub with no
// `randomBytes` or `getRandomValues`. secrets.js-grempe's RNG
// auto-detection then finds nothing usable and throws
// "Initialization failed." the moment the module loads — breaking
// Circle-of-trust activation (2-of-5 key splitting) in production.
//
// Aliasing the bare "crypto" specifier to this shim (see
// vite.config.js) gives the library's `require("crypto")` an object
// shaped like the browser's Crypto interface instead, so its own
// `hasCryptoGetRandomValues()` check passes and it uses the real
// window.crypto under the hood.
module.exports = {
  getRandomValues: (arr) => window.crypto.getRandomValues(arr)
};
