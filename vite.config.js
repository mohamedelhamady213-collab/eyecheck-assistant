import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig(({ mode }) => ({
  resolve: { alias: mode === "test" ? { "./firebase.js": fileURLToPath(new URL("./src/firebase.mock.js", import.meta.url)) } : {} },
  build: { target: "es2022" },
}));
