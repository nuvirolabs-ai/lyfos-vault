const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Resolve crypto polyfill shims if any sub-dep tries `import { randomBytes } from "crypto"`.
// Expo + react-native ships these via `react-native-get-random-values` (loaded at app entry).
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  buffer: require.resolve("buffer/"),
  // secrets.js-grempe does `require("crypto")` under CommonJS; shim it to a
  // browser-style CSPRNG backed by the react-native-get-random-values polyfill.
  crypto: require.resolve("./src/shims/crypto.js")
};

module.exports = config;
