"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { ApnsError, sendApnsNotification, type PushData } from "./apns";

function isPushData(value: unknown): value is PushData {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const sendApnsToDevice = internalAction({
  args: {
    deviceToken: v.string(),
    title: v.string(),
    body: v.string(),
    data: v.optional(v.any()),
  },
  handler: async (_ctx, args) => {
    const data = isPushData(args.data) ? args.data : undefined;

    try {
      const response = await sendApnsNotification({
        deviceToken: args.deviceToken,
        title: args.title,
        body: args.body,
        data,
      });

      return {
        ok: true,
        status: response.status,
        apnsId: response.apnsId,
      };
    } catch (error) {
      const apnsError = error instanceof ApnsError
        ? error
        : new ApnsError(error instanceof Error ? error.message : String(error));

      return {
        ok: false,
        status: apnsError.status,
        reason: apnsError.reason,
        error: apnsError.message,
      };
    }
  },
});
