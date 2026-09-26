import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    target: "es2022",
    cssMinify: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        about: resolve(__dirname, "about.html"),
        play: resolve(__dirname, "play.html"),
        howToPlay: resolve(__dirname, "how-to-play.html"),
        catGames: resolve(__dirname, "cat-games.html")
      }
    }
  }
});
