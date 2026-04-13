const rawVersion = process.env.COWTAIL_VERSION?.trim() || "dev";

export const cowtailVersion = rawVersion;
export const cowtailVersionLabel = rawVersion === "dev" || rawVersion.startsWith("v")
  ? rawVersion
  : `v${rawVersion}`;
