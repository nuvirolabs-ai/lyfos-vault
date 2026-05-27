import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Generate a unique build id per build. Inlined into the app (via __BUILD_ID__)
// AND substituted into the service worker so its cache name changes on every
// deploy — returning visitors don't get stuck on a stale bundle.
const BUILD_ID = `${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}-${Math.random().toString(36).slice(2, 8)}`;

function serviceWorkerBuildIdPlugin() {
  return {
    name: "lyfos-sw-build-id",
    apply: "build",
    generateBundle() {
      const swPath = resolve(__dirname, "public/sw.js");
      const source = readFileSync(swPath, "utf-8").replace(/__BUILD_ID__/g, BUILD_ID);
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    }
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorkerBuildIdPlugin()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID)
  },
  build: {
    rollupOptions: {
      output: {
        // Split heavy third-party deps into their own chunks so they cache
        // independently of the app code and don't bloat the main bundle.
        manualChunks(id) {
          if (id.includes("node_modules/@supabase/")) return "supabase";
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) return "react";
          if (id.includes("node_modules/tesseract.js")) return "tesseract";
          if (id.includes("node_modules/hash-wasm")) return "crypto-argon2";
          if (id.includes("node_modules/@scure/bip39")) return "crypto-bip39";
        }
      }
    }
  }
});
