const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Resolve crypto polyfill shims if any sub-dep tries `import { randomBytes } from "crypto"`.
// Expo + react-native ships these via `react-native-get-random-values` (loaded at app entry).
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  buffer: require.resolve("buffer/")
};

module.exports = config;
