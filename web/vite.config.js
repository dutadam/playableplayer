import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";

const useHttps = process.env.PLAYABLE_HTTPS === "1";
const base = process.env.PLAYABLE_BASE || "/";

export default defineConfig({
  base,
  plugins: useHttps ? [basicSsl()] : [],
  server: {
    allowedHosts: [".loca.lt"],
    ...(useHttps ? { https: true } : {})
  },
  preview: useHttps ? { https: true } : {}
});
