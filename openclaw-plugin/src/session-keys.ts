export function normalizeCowtailTarget(raw: string): string {
  return raw
    .trim()
    .replace(/^cowtail:/i, "")
    .trim();
}

export function buildCowtailTarget(threadId: string): string {
  return `cowtail:${normalizeCowtailTarget(threadId)}`;
}

export function resolveCowtailThreadIdFromSessionKey(
  sessionKey: string | null | undefined,
): string | undefined {
  const raw = (sessionKey ?? "").trim();
  if (!raw) {
    return undefined;
  }

  const parts = raw.split(":").filter(Boolean);
  if (parts.length < 4 || parts[0]?.toLowerCase() !== "agent") {
    return undefined;
  }

  const cowtailIndex = parts.findIndex(
    (part, index) => index >= 2 && part.toLowerCase() === "cowtail",
  );
  if (cowtailIndex < 0) {
    if (parts[2]?.toLowerCase() !== "direct") {
      return undefined;
    }
    const directTarget = normalizeCowtailTarget(parts.slice(3).join(":"));
    return directTarget || undefined;
  }

  const rest = parts.slice(cowtailIndex + 1);
  const first = rest[0]?.toLowerCase();
  const second = rest[1]?.toLowerCase();
  const target =
    first === "direct" || first === "group" || first === "channel"
      ? rest.slice(1).join(":")
      : second === "direct" || second === "group" || second === "channel"
        ? rest.slice(2).join(":")
        : rest.join(":");
  const normalized = normalizeCowtailTarget(target);
  return normalized || undefined;
}

export function isSupportedCowtailAgent(agentId: string | null | undefined): boolean {
  return (agentId ?? "main").trim() === "main";
}
