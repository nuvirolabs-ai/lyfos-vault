// Metro shim for Node's core `crypto` module.
//
// secrets.js-grempe (Shamir SSS, used by the release flow) is a UMD module
// that does `factory(require("crypto"))` under CommonJS. React Native has no
// node `crypto`, so Metro fails to resolve it. The library only needs a
// CSPRNG and prefers the browser path `crypto.getRandomValues`, which
// react-native-get-random-values polyfills onto `global.crypto` at app start
// (see src/polyfills.ts, imported first in index.ts).
//
// We delegate to global.crypto at call time so detection
// (`typeof crypto.getRandomValues === "function"`) and usage both succeed,
// keeping the share format byte-identical with the web build.
module.exports = {
  getRandomValues(array) {
    return global.crypto.getRandomValues(array);
  }
};
