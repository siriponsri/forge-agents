import { defineConfig } from "vite";
import {fileURLToPath} from 'node:url';
export default defineConfig({
  server: { host: "127.0.0.1", proxy: { "/api": "http://127.0.0.1:4317" } },
  build: { chunkSizeWarningLimit: 1600,rollupOptions:{input:{app:fileURLToPath(new URL('./index.html',import.meta.url)),welcome:fileURLToPath(new URL('./welcome.html',import.meta.url))}} },
});
