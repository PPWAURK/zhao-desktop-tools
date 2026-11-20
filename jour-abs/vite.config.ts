import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

// Tauri expects a fixed dev port and keeps its own log output on screen.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "safari15", outDir: "dist", emptyOutDir: true },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
})
