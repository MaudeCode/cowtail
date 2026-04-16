import { v } from "convex/values";

import { api, internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import {
  buildDailyDigestBody,
  buildDigestCounts,
  buildDailyDigestPayload,
  resolveDigestWindow,
  resolvePreviousDigestWindow,
  shouldRunDailyDigestAt,
  type DigestWindow,
} from "./digest";
import { sendPushToUser } from "./pushDelivery";

const DEFAULT_DIGEST_HOUR_LOCAL = 8;
const DEFAULT_DIGEST_TIMEZONE = "America/New_York";
const DAILY_DIGEST_TITLE = "Cowtail Daily Digest";

type DigestNotification = {
  counts: ReturnType<typeof buildDigestCounts>;
  payload: ReturnType<typeof buildDailyDigestPayload>;
  title: string;
  body: string;
};

function nonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveDigestTimeZone(): string {
  const timeZone = nonEmptyString(process.env.DAILY_DIGEST_TIMEZONE) ?? DEFAULT_DIGEST_TIMEZONE;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
  } catch (error) {
    throw new Error(
      `Invalid DAILY_DIGEST_TIMEZONE: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return timeZone;
}

function resolveDigestHourLocal(): number {
  const raw = nonEmptyString(process.env.DAILY_DIGEST_HOUR_LOCAL);
  if (!raw) {
    return DEFAULT_DIGEST_HOUR_LOCAL;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 23) {
    throw new Error("DAILY_DIGEST_HOUR_LOCAL must be an integer between 0 and 23");
  }

  return parsed;
}

function cowtailWebOrigin(): string {
  const origin =
    nonEmptyString(process.env.COWTAIL_WEB_ORIGIN) ??
    nonEmptyString(process.env.SITE_ORIGIN) ??
    "https://cowtail.example.com";

  return origin.replace(/\/+$/, "");
}

function resolveRequestedWindow(
  digestFrom: string | undefined,
  digestTo: string | undefined,
  timeZone: string,
): DigestWindow {
  if (!digestFrom && !digestTo) {
    return resolvePreviousDigestWindow(new Date(), timeZone);
  }

  const resolvedFrom = digestFrom ?? digestTo;
  const resolvedTo = digestTo ?? digestFrom;

  if (!resolvedFrom || !resolvedTo) {
    throw new Error("Digest range could not be resolved");
  }

  if (resolvedFrom > resolvedTo) {
    throw new Error("Digest from date must be less than or equal to the to date");
  }

  return resolveDigestWindow(resolvedFrom, resolvedTo, timeZone);
}

async function buildDigestNotification(
  ctx: Parameters<typeof sendPushToUser>[0],
  window: DigestWindow,
): Promise<DigestNotification> {
  const [alerts, fixes]: [Array<{ outcome: string }>, Array<unknown>] = await Promise.all([
    ctx.runQuery(api.alerts.getByTimeRange, {
      from: window.fromTimestamp,
      to: window.toTimestamp,
    }),
    ctx.runQuery(api.fixes.getByTimeRange, {
      from: window.fromTimestamp,
      to: window.toTimestamp,
    }),
  ]);

  const counts = buildDigestCounts(alerts, fixes);
  const payload = buildDailyDigestPayload(window, cowtailWebOrigin());
  const body = buildDailyDigestBody(window, counts);

  return {
    counts,
    payload,
    title: DAILY_DIGEST_TITLE,
    body,
  };
}

export const sendTestDailyDigest = internalAction({
  args: {
    userId: v.string(),
    digestFrom: v.optional(v.string()),
    digestTo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const timeZone = resolveDigestTimeZone();
    const window = resolveRequestedWindow(args.digestFrom, args.digestTo, timeZone);
    const notification = await buildDigestNotification(ctx, window);
    const result = await sendPushToUser(ctx, {
      userId: args.userId,
      title: notification.title,
      body: notification.body,
      data: notification.payload,
    });

    return {
      ...result,
      digestFrom: window.digestFrom,
      digestTo: window.digestTo,
      title: notification.title,
      body: notification.body,
    };
  },
});

export const runScheduledDailyDigests = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = new Date();
    const timeZone = resolveDigestTimeZone();
    const localHour = resolveDigestHourLocal();

    if (!shouldRunDailyDigestAt(now, timeZone, localHour)) {
      return {
        ok: true,
        skipped: true,
        reason: "outside_schedule_window",
      };
    }

    const window = resolvePreviousDigestWindow(now, timeZone);
    const users = await ctx.runQuery(internal.notificationPreferences.listUsersWithDailyDigestEnabled, {});

    if (users.length === 0) {
      return {
        ok: true,
        skipped: false,
        digestFrom: window.digestFrom,
        digestTo: window.digestTo,
        attemptedUsers: 0,
        deliveredUsers: 0,
      };
    }

    const notification = await buildDigestNotification(ctx, window);
    let attemptedUsers = 0;
    let deliveredUsers = 0;
    let sent = 0;
    let failed = 0;

    for (const user of users) {
      if (user.lastDigestKeySent === window.digestKey) {
        continue;
      }

      const claim = await ctx.runMutation(internal.notificationPreferences.claimDigestKey, {
        userId: user.userId,
        digestKey: window.digestKey,
      });

      if (!claim.claimed) {
        continue;
      }

      attemptedUsers += 1;
      try {
        const result = await sendPushToUser(ctx, {
          userId: user.userId,
          title: notification.title,
          body: notification.body,
          data: notification.payload,
        });

        sent += result.sent;
        failed += result.failed;

        if (result.sent > 0) {
          deliveredUsers += 1;
          await ctx.runMutation(internal.notificationPreferences.markLastDigestKeySent, {
            userId: user.userId,
            lastDigestKeySent: window.digestKey,
          });
        } else {
          await ctx.runMutation(internal.notificationPreferences.releaseDigestKeyClaim, {
            userId: user.userId,
            digestKey: window.digestKey,
          });
        }
      } catch (error) {
        await ctx.runMutation(internal.notificationPreferences.releaseDigestKeyClaim, {
          userId: user.userId,
          digestKey: window.digestKey,
        });
        throw error;
      }
    }

    return {
      ok: failed === 0,
      skipped: false,
      digestFrom: window.digestFrom,
      digestTo: window.digestTo,
      attemptedUsers,
      deliveredUsers,
      sent,
      failed,
    };
  },
});
