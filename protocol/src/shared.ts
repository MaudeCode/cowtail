import { z } from "zod";

export const alertOutcomes = ["fixed", "self-resolved", "noise", "escalated"] as const;
export const alertStatuses = ["firing", "resolved"] as const;
export const fixScopes = ["reactive", "weekly", "monthly"] as const;
export const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

export const nonEmptyStringSchema = z.string().trim().min(1);
export const timestampSchema = z.number().int().nonnegative();
export const jsonObjectSchema = z.record(z.string(), z.unknown());
export const dateOnlyStringSchema = z
  .string()
  .trim()
  .regex(dateOnlyPattern, "Expected YYYY-MM-DD date format");
