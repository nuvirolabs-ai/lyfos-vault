const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  buffer: require.resolve("buffer/"),
  // secrets.js-grempe does `require("crypto")` under CommonJS; shim it to a
  // browser-style CSPRNG backed by the react-native-get-random-values polyfill.
  crypto: require.resolve("./src/shims/crypto.js")
};

// In this npm-workspaces monorepo, react-native is hoisted to the repo root
// while the app pins its own react — so the bundle ends up with TWO copies of
// react (the RN renderer's vs the app's) → "Invalid hook call / useState of
// null". Force every react + react-native resolution to a single copy.
const SINGLETONS = {
  react: path.resolve(__dirname, "node_modules/react"),
  "react-native": path.resolve(__dirname, "../../node_modules/react-native")
};
const prevResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  for (const [name, dir] of Object.entries(SINGLETONS)) {
    if (moduleName === name || moduleName.startsWith(name + "/")) {
      const redirected = dir + moduleName.slice(name.length);
      return context.resolveRequest(context, redirected, platform);
    }
  }
  return (prevResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
