const rawVersion = import.meta.env.VITE_APP_VERSION?.trim() || "dev";

export const appVersion = rawVersion;
export const appVersionLabel = rawVersion === "dev" || rawVersion.startsWith("v")
  ? rawVersion
  : `v${rawVersion}`;
