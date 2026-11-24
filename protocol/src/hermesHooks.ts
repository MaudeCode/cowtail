import { z } from "zod";

import { jsonObjectSchema, nonEmptyStringSchema } from "./shared.ts";

// The JSON body of a Hermes outbound webhook (`hooks.outbound` in Hermes's config.yaml).
// Only the fields Cowtail reads are checked; `extra` holds the event's own fields.
export const hermesHookPayloadSchema = z.object({
  hook_event_name: nonEmptyStringSchema,
  profile: z.string().nullish(),
  delivery_id: nonEmptyStringSchema.max(200),
  extra: jsonObjectSchema.nullish(),
});

export type HermesHookPayload = z.infer<typeof hermesHookPayloadSchema>;
