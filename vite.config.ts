import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    target: "es2022",
    cssMinify: true,
    assetsInlineLimit: 0,
    // three.js is shared by the solo game and the 1v1 arena; keep it in its own cacheable chunk
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: { manualChunks: { three: ["three"] } },
      input: {
        main: resolve(__dirname, "index.html"),
        about: resolve(__dirname, "about.html"),
        play: resolve(__dirname, "play.html"),
        howToPlay: resolve(__dirname, "how-to-play.html"),
        catGames: resolve(__dirname, "cat-games.html"),
        terms: resolve(__dirname, "terms.html"),
        privacy: resolve(__dirname, "privacy.html")
      }
    }
  }
});
