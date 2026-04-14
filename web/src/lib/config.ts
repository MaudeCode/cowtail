export interface AppConfig {
  cephDashboardUrl?: string;
}

let cached: AppConfig | null = null;

export async function getConfig(): Promise<AppConfig> {
  if (cached) return cached;
  try {
    const res = await fetch("/config.json");
    if (res.ok) {
      cached = await res.json();
      return cached!;
    }
  } catch {
    // config.json is optional
  }
  cached = {};
  return cached;
}
