import type { ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { isInvalidDeviceTokenReason } from "./apns";

export async function sendPushToUser(
  ctx: ActionCtx,
  args: {
    userId: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
  },
) {
  const devices = await ctx.runQuery(api.push.listEnabledDevicesForUser, { userId: args.userId });

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

  for (const device of devices) {
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

      if (isInvalidDeviceTokenReason(result.reason)) {
        await ctx.runMutation(api.push.disableDeviceRegistrationByToken, {
          deviceToken: device.deviceToken,
        });
      }
    }

    results.push({
      deviceToken:
        device.deviceToken.length <= 12
          ? device.deviceToken
          : `${device.deviceToken.slice(0, 6)}…${device.deviceToken.slice(-6)}`,
      ...result,
    });
  }

  return {
    ok: failed === 0,
    userId: args.userId,
    sent,
    failed,
    results,
  };
}
