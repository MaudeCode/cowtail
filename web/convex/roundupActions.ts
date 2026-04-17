import { v } from "convex/values";

import { api, internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import {
  buildDailyRoundupBody,
  buildRoundupCounts,
  buildDailyRoundupPayload,
  resolveRoundupWindow,
  resolvePreviousRoundupWindow,
  shouldRunDailyRoundupAt,
  type RoundupWindow,
} from "./roundup";
import { sendPushToUser } from "./pushDelivery";

const DEFAULT_ROUNDUP_HOUR_LOCAL = 8;
const DEFAULT_ROUNDUP_TIMEZONE = "America/New_York";
const DAILY_ROUNDUP_TITLE = "Cowtail Daily Roundup";

type RoundupNotification = {
  counts: ReturnType<typeof buildRoundupCounts>;
  payload: ReturnType<typeof buildDailyRoundupPayload>;
  title: string;
  body: string;
};

function nonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveRoundupTimeZone(): string {
  const timeZone = nonEmptyString(process.env.DAILY_ROUNDUP_TIMEZONE) ?? DEFAULT_ROUNDUP_TIMEZONE;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
  } catch (error) {
    throw new Error(
      `Invalid DAILY_ROUNDUP_TIMEZONE: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return timeZone;
}

function resolveRoundupHourLocal(): number {
  const raw = nonEmptyString(process.env.DAILY_ROUNDUP_HOUR_LOCAL);
  if (!raw) {
    return DEFAULT_ROUNDUP_HOUR_LOCAL;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 23) {
    throw new Error("DAILY_ROUNDUP_HOUR_LOCAL must be an integer between 0 and 23");
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
  roundupFrom: string | undefined,
  roundupTo: string | undefined,
  timeZone: string,
): RoundupWindow {
  if (!roundupFrom && !roundupTo) {
    return resolvePreviousRoundupWindow(new Date(), timeZone);
  }

  const resolvedFrom = roundupFrom ?? roundupTo;
  const resolvedTo = roundupTo ?? roundupFrom;

  if (!resolvedFrom || !resolvedTo) {
    throw new Error("Roundup range could not be resolved");
  }

  if (resolvedFrom > resolvedTo) {
    throw new Error("Roundup from date must be less than or equal to the to date");
  }

  return resolveRoundupWindow(resolvedFrom, resolvedTo, timeZone);
}

async function buildRoundupNotification(
  ctx: Parameters<typeof sendPushToUser>[0],
  window: RoundupWindow,
): Promise<RoundupNotification> {
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

  const counts = buildRoundupCounts(alerts, fixes);
  const payload = buildDailyRoundupPayload(window, cowtailWebOrigin());
  const body = buildDailyRoundupBody(window, counts);

  return {
    counts,
    payload,
    title: DAILY_ROUNDUP_TITLE,
    body,
  };
}

export const sendTestDailyRoundup = internalAction({
  args: {
    userId: v.string(),
    roundupFrom: v.optional(v.string()),
    roundupTo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const timeZone = resolveRoundupTimeZone();
    const window = resolveRequestedWindow(args.roundupFrom, args.roundupTo, timeZone);
    const notification = await buildRoundupNotification(ctx, window);
    const result = await sendPushToUser(ctx, {
      userId: args.userId,
      title: notification.title,
      body: notification.body,
      data: notification.payload,
    });

    return {
      ...result,
      roundupFrom: window.roundupFrom,
      roundupTo: window.roundupTo,
      title: notification.title,
      body: notification.body,
    };
  },
});

export const runScheduledDailyRoundups = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = new Date();
    const timeZone = resolveRoundupTimeZone();
    const localHour = resolveRoundupHourLocal();

    if (!shouldRunDailyRoundupAt(now, timeZone, localHour)) {
      return {
        ok: true,
        skipped: true,
        reason: "outside_schedule_window",
      };
    }

    const window = resolvePreviousRoundupWindow(now, timeZone);
    const users = await ctx.runQuery(
      internal.notificationPreferences.listUsersWithDailyRoundupEnabled,
      {},
    );

    if (users.length === 0) {
      return {
        ok: true,
        skipped: false,
        roundupFrom: window.roundupFrom,
        roundupTo: window.roundupTo,
        attemptedUsers: 0,
        deliveredUsers: 0,
      };
    }

    const notification = await buildRoundupNotification(ctx, window);
    let attemptedUsers = 0;
    let deliveredUsers = 0;
    let sent = 0;
    let failed = 0;

    for (const user of users) {
      if (user.lastRoundupKeySent === window.roundupKey) {
        continue;
      }

      const claim = await ctx.runMutation(internal.notificationPreferences.claimRoundupKey, {
        userId: user.userId,
        roundupKey: window.roundupKey,
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
          await ctx.runMutation(internal.notificationPreferences.markLastRoundupKeySent, {
            userId: user.userId,
            lastRoundupKeySent: window.roundupKey,
          });
        } else {
          await ctx.runMutation(internal.notificationPreferences.releaseRoundupKeyClaim, {
            userId: user.userId,
            roundupKey: window.roundupKey,
          });
        }
      } catch (error) {
        await ctx.runMutation(internal.notificationPreferences.releaseRoundupKeyClaim, {
          userId: user.userId,
          roundupKey: window.roundupKey,
        });
        throw error;
      }
    }

    return {
      ok: failed === 0,
      skipped: false,
      roundupFrom: window.roundupFrom,
      roundupTo: window.roundupTo,
      attemptedUsers,
      deliveredUsers,
      sent,
      failed,
    };
  },
});
