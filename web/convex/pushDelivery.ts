import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { configuredApnsEnvironment, isInvalidDeviceTokenReason } from "./apns";
import { previewDeviceToken } from "./deviceTokenPreview";

export async function sendPushToUser(
  ctx: ActionCtx,
  args: {
    userId: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
  },
) {
  const devices = await ctx.runQuery(internal.push.listEnabledDevicesForUser, {
    userId: args.userId,
  });

  if (devices.length === 0) {
    return {
      ok: true,
      userId: args.userId,
      sent: 0,
      failed: 0,
      results: [] as Array<Record<string, unknown>>,
    };
  }

  const results: Array<Record<string, unknown>> = [];
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const activeEnvironment = configuredApnsEnvironment();

  for (const device of devices) {
    if (device.environment !== activeEnvironment) {
      skipped += 1;
      results.push({
        deviceToken: previewDeviceToken(device.deviceToken),
        environment: device.environment,
        skipped: true,
        reason: "APNSEnvironmentMismatch",
        activeEnvironment,
      });
      continue;
    }

    const result = await ctx.runAction(internal.pushActions.sendApnsToDevice, {
      deviceToken: device.deviceToken,
      title: args.title,
      body: args.body,
      data: args.data,
    });

    if (result.ok) {
      sent += 1;
    } else {
      failed += 1;

      if (isInvalidDeviceTokenReason(result.reason) && device.environment === activeEnvironment) {
        await ctx.runMutation(internal.push.disableDeviceRegistrationByToken, {
          userId: args.userId,
          deviceToken: device.deviceToken,
        });
      }
    }

    results.push({
      deviceToken: previewDeviceToken(device.deviceToken),
      environment: device.environment,
      ...result,
    });
  }

  return {
    ok: failed === 0 && (sent > 0 || skipped === 0),
    userId: args.userId,
    sent,
    failed,
    skipped,
    results,
  };
}
