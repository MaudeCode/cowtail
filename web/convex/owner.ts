// Cowtail is single-owner: items, item pushes and owner actions belong to this user.
export function cowtailOwnerUserId(): string | undefined {
  for (const name of ["COWTAIL_OWNER_USER_ID", "COWTAIL_OPENCLAW_OWNER_USER_ID"]) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}
