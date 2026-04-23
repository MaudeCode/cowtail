export function normalizeCowtailTarget(raw: string): string {
  return raw.trim().replace(/^cowtail:/i, "").trim();
}

export function buildCowtailTarget(threadId: string): string {
  return `cowtail:${normalizeCowtailTarget(threadId)}`;
}

export function isSupportedCowtailAgent(agentId: string | null | undefined): boolean {
  return (agentId ?? "main").trim() === "main";
}
