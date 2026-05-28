// Polyfills must run before any other code. expo-router's auto-entry
// resolves `./app/_layout` after this file has loaded.
import "./src/polyfills";
import "expo-router/entry";
