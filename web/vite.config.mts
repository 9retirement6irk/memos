import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { resolve } from "path";
import { defineConfig, type Plugin } from "vite";
import { hookCanvasSource } from "./src/components/DrawingSheet/gzreader/canvasHook";
import tailwindcss from "@tailwindcss/vite";

let devProxyServer = "http://localhost:8081";
if (process.env.DEV_PROXY_SERVER && process.env.DEV_PROXY_SERVER.length > 0) {
  console.log("Use devProxyServer from environment: ", process.env.DEV_PROXY_SERVER);
  devProxyServer = process.env.DEV_PROXY_SERVER;
}

/**
 * Lets the drawing engine's pen strokes be drawn by the fork (GZreader's writing tools, see
 * `src/components/DrawingSheet/gzreader`). The build stops if the engine no longer has the
 * place this reaches, so an engine update can't quietly lose them.
 */
const canvasFreedrawHook = (): Plugin => ({
  name: "memos-canvas-freedraw-hook",
  enforce: "pre",
  transform(code, id) {
    if (!/[\\/]@usememos[\\/]canvas[\\/]dist[\\/]index\.js(\?|$)/.test(id)) return null;
    const hooked = hookCanvasSource(code);
    if (hooked === null) this.error("@usememos/canvas no longer fills pen strokes where the GZreader hook expects (gzreader/canvasHook.ts)");
    return { code: hooked, map: null };
  },
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [canvasFreedrawHook(), react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  // The dev server's bundled copy of a dependency skips plugins, so the engine is served as it is.
  optimizeDeps: { exclude: ["@usememos/canvas"] },
  server: {
    host: "0.0.0.0",
    port: 3001,
    proxy: {
      "^/api/sse": {
        target: devProxyServer,
        xfwd: true,
        // SSE requires no response buffering and longer timeout.
        timeout: 0,
      },
      "^/api": {
        target: devProxyServer,
        xfwd: true,
      },
      "^/memos.api": {
        target: devProxyServer,
        xfwd: true,
      },
      "^/file": {
        target: devProxyServer,
        xfwd: true,
      },
    },
  },
  resolve: {
    alias: {
      "@/": `${resolve(__dirname, "src")}/`,
    },
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "utils-vendor",
              test: /node_modules[\\/](dayjs|lodash-es)([\\/]|$)/,
            },
            {
              name: "leaflet-vendor",
              test: /node_modules[\\/]leaflet([\\/]|$)/,
            },
          ],
        },
      },
    },
  },
});
