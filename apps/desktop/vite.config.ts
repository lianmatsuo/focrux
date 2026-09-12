import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ base: "./", plugins: [react()], server: { host: "127.0.0.1", port: 51859, strictPort: true }, build: { outDir: "dist/renderer", sourcemap: true }, resolve: { dedupe: ["react", "react-dom"] } });
