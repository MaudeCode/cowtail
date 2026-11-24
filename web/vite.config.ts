import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // The app calls the Convex HTTP actions under /actions on its own origin, as nginx serves
  // them in production. In development, set COWTAIL_DEV_ACTIONS_URL to the deployment's
  // HTTP actions URL to proxy them.
  const actions = loadEnv(mode, process.cwd(), "").COWTAIL_DEV_ACTIONS_URL;
  return {
    plugins: [tailwindcss(), react()],
    server: {
      allowedHosts: true,
      proxy: actions
        ? {
            "/actions": {
              target: actions,
              changeOrigin: true,
              rewrite: (path) => path.replace(/^\/actions/, ""),
            },
          }
        : undefined,
    },
  };
});
