export function previewDeviceToken(deviceToken: string) {
  return deviceToken.length <= 12
    ? `redacted:${deviceToken.length}`
    : `${deviceToken.slice(0, 6)}...${deviceToken.slice(-6)}`;
}
