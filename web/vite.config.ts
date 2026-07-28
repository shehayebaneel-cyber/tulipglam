import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// TulipGlam — web dev server on 5330, API on 4230
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5330,
    proxy: {
      "/api": "http://localhost:4230",
      "/uploads": "http://localhost:4230",
    },
  },
});
