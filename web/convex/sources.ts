import type { SourceInfo, SourceRecord } from "@maudecode/cowtail-protocol";
import { ConvexError, v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { cowtailWebOrigin } from "./owner";

// The producers Cowtail itself knows. They post with service auth, so they have no token.
// `manual` is the CLI's `notify` default.
export const builtinSources = [
  { slug: "alertmanager", displayName: "Alertmanager" },
  { slug: "hermes", displayName: "Hermes" },
  { slug: "cowtail", displayName: "Cowtail" },
  { slug: "manual", displayName: "Manual" },
] as const;

export const SOURCE_TOKEN_PREFIX = "cts_";

const ICON_MAX_BYTES = 256 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Why the bytes cannot be a source icon, or undefined for a square PNG of 64 to 1024 px. */
export function sourceIconError(bytes: Uint8Array): string | undefined {
  if (bytes.length > ICON_MAX_BYTES) return "Icon must be at most 256 KB";
  const ihdr = String.fromCharCode(...bytes.subarray(12, 16));
  if (bytes.length < 24 || PNG_SIGNATURE.some((byte, i) => bytes[i] !== byte) || ihdr !== "IHDR") {
    return "Icon must be a PNG";
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  if (width !== view.getUint32(20)) return "Icon must be square";
  if (width < 64 || width > 1024) return "Icon must be 64 to 1024 pixels wide";
  return undefined;
}

export function sourceIconUrl(slug: string) {
  return `${cowtailWebOrigin()}/actions/api/sources/${encodeURIComponent(slug)}/icon`;
}

export async function sourceBySlug(ctx: QueryCtx, slug: string) {
  return await ctx.db
    .query("sources")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
}

function info(source: Pick<Doc<"sources">, "slug" | "displayName" | "iconStorageId">): SourceInfo {
  return {
    slug: source.slug,
    displayName: source.displayName,
    ...(source.iconStorageId ? { iconUrl: sourceIconUrl(source.slug) } : {}),
  };
}

// An item from a source no row names, such as an old alert's `weekly-review`, shows its slug.
export async function sourceInfo(ctx: QueryCtx, slug: string): Promise<SourceInfo> {
  const source = await sourceBySlug(ctx, slug);
  return source ? info(source) : { slug, displayName: slug };
}

function sourceRecord(source: Doc<"sources">): SourceRecord {
  return {
    ...info(source),
    enabled: source.enabled,
    hasToken: source.tokenHash !== undefined,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

async function requireSource(ctx: QueryCtx, slug: string) {
  const source = await sourceBySlug(ctx, slug);
  if (!source) throw new ConvexError({ code: "SOURCE_NOT_FOUND" });
  return source;
}

// Seeds the built-in sources. Safe to run again: it never touches an existing row.
export const seedBuiltinSources = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let created = 0;
    for (const source of builtinSources) {
      if (await sourceBySlug(ctx, source.slug)) continue;
      await ctx.db.insert("sources", { ...source, enabled: true, createdAt: now, updatedAt: now });
      created += 1;
    }
    return { created };
  },
});

export const getBySlug = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const source = await sourceBySlug(ctx, slug);
    return source ? sourceRecord(source) : null;
  },
});

// The source a token belongs to. Lookup is by the token's digest, never by the token.
export const getByTokenHash = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const source = await ctx.db
      .query("sources")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    return source ? { slug: source.slug, enabled: source.enabled } : null;
  },
});

export const list = internalQuery({
  args: {},
  handler: async (ctx) => {
    const sources = await ctx.db.query("sources").withIndex("by_slug").collect();
    return sources.map(sourceRecord);
  },
});

export const create = internalMutation({
  args: { slug: v.string(), displayName: v.string(), tokenHash: v.string(), now: v.number() },
  handler: async (ctx, { slug, displayName, tokenHash, now }) => {
    if (await sourceBySlug(ctx, slug)) throw new ConvexError({ code: "SOURCE_EXISTS" });
    const id = await ctx.db.insert("sources", {
      slug,
      displayName,
      tokenHash,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    return sourceRecord((await ctx.db.get(id))!);
  },
});

// The new digest replaces the old one, so the old token stops working in the same write.
export const rotateToken = internalMutation({
  args: { slug: v.string(), tokenHash: v.string(), now: v.number() },
  handler: async (ctx, { slug, tokenHash, now }) => {
    const source = await requireSource(ctx, slug);
    await ctx.db.patch(source._id, { tokenHash, updatedAt: now });
    return sourceRecord((await ctx.db.get(source._id))!);
  },
});

export const patch = internalMutation({
  args: {
    slug: v.string(),
    displayName: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
    now: v.number(),
  },
  handler: async (ctx, { slug, now, ...changes }) => {
    const source = await requireSource(ctx, slug);
    await ctx.db.patch(source._id, { ...changes, updatedAt: now });
    return sourceRecord((await ctx.db.get(source._id))!);
  },
});

// Points the source at a stored icon and deletes the file it replaces. A source deleted
// meanwhile gets nothing, and the new file goes too.
export const setIcon = internalMutation({
  args: { slug: v.string(), storageId: v.id("_storage"), now: v.number() },
  handler: async (ctx, { slug, storageId, now }) => {
    const source = await sourceBySlug(ctx, slug);
    if (!source) {
      await ctx.storage.delete(storageId);
      return null;
    }
    if (source.iconStorageId) await ctx.storage.delete(source.iconStorageId);
    await ctx.db.patch(source._id, { iconStorageId: storageId, updatedAt: now });
    return sourceRecord((await ctx.db.get(source._id))!);
  },
});

export const iconStorageId = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => (await sourceBySlug(ctx, slug))?.iconStorageId ?? null,
});
