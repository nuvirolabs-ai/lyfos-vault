module.exports = function (api) {
  api.cache(true);
  return {
    // SDK 54: babel-preset-expo auto-includes react-native-worklets/plugin
    // (reanimated v4), so no manual reanimated plugin is needed here.
    presets: ["babel-preset-expo"]
  };
};
