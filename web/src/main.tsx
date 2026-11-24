import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "./lib/api";
import { appVersion } from "./lib/version";
import App from "./App";
import "./index.css";

document.documentElement.dataset.cowtailVersion = appVersion;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={createQueryClient()}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
