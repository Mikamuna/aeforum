import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/forum/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // The production server mounts the SPA at /forum/ and proxies /forum/api
      // to the Python forum API. Mirror that path in local development.
      "/forum/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: false,
        rewrite: (requestPath) => requestPath.replace(/^\/forum/, ""),
      },
    },
  },
});
