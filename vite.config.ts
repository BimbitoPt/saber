import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

export default defineConfig({
  plugins: [tailwindcss(), tanstackStart(), viteReact(), nitro()],
  resolve: {
    tsconfigPaths: true,
    alias: { "@": String(new URL("./src", import.meta.url)).replace(/\\/g, "/").replace(/\/$/, "") },
    dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-start"],
  },
  server: {
    host: "::",
    port: 8082,
    strictPort: true,
  },
});
