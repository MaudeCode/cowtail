import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { OpenApiGeneratorV3, OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

import {
  authSessionCreateRequestSchema,
  authSessionCreateResponseSchema,
  healthResponseSchema,
  notificationPreferencesResponseSchema,
  notificationPreferencesUpdateRequestSchema,
  pushRegisterRequestSchema,
  pushRegisterResponseSchema,
  pushUnregisterRequestSchema,
  pushUnregisterResponseSchema,
} from "../src/index.js";

const registry = new OpenAPIRegistry();

const nonEmptyStringSchema = z.string().trim().min(1);
const timestampSchema = z.number().finite().nonnegative();
const convexStatusSchema = z.enum(["success", "error"]);
const convexFormatSchema = z.literal("convex_encoded_json");

const convexAlertRecordSchema = z
  .object({
    _id: nonEmptyStringSchema,
    timestamp: timestampSchema,
    alertname: nonEmptyStringSchema,
    severity: z.string(),
    namespace: z.string(),
    node: z.string().optional(),
    status: z.string(),
    outcome: z.string(),
    summary: z.string(),
    action: z.string().optional(),
    rootCause: z.string().optional(),
    resolvedAt: timestampSchema.optional(),
    messaged: z.boolean().optional(),
  })
  .meta({ id: "ConvexAlertRecord" });

const convexFixRecordSchema = z
  .object({
    _id: nonEmptyStringSchema,
    description: z.string().optional(),
    rootCause: z.string().optional(),
    scope: z.string().optional(),
    timestamp: timestampSchema,
  })
  .meta({ id: "ConvexFixRecord" });

const fetchAlertsRequestSchema = z
  .object({
    path: z.literal("alerts:getByTimeRange"),
    args: z.object({
      from: timestampSchema,
      to: timestampSchema,
    }),
    format: convexFormatSchema,
  })
  .meta({ id: "ConvexFetchAlertsRequest" });

const fetchAlertRequestSchema = z
  .object({
    path: z.literal("alerts:getById"),
    args: z.object({
      id: nonEmptyStringSchema,
    }),
    format: convexFormatSchema,
  })
  .meta({ id: "ConvexFetchAlertRequest" });

const fetchFixesRequestSchema = z
  .object({
    path: z.literal("fixes:getByAlertIds"),
    args: z.object({
      alertIds: z.array(nonEmptyStringSchema).min(1),
    }),
    format: convexFormatSchema,
  })
  .meta({ id: "ConvexFetchFixesRequest" });

const fetchFixesByTimeRangeRequestSchema = z
  .object({
    path: z.literal("fixes:getByTimeRange"),
    args: z.object({
      from: timestampSchema,
      to: timestampSchema,
    }),
    format: convexFormatSchema,
  })
  .meta({ id: "ConvexFetchFixesByTimeRangeRequest" });

const convexQueryRequestSchema = z
  .union([
    fetchAlertsRequestSchema,
    fetchAlertRequestSchema,
    fetchFixesRequestSchema,
    fetchFixesByTimeRangeRequestSchema,
  ])
  .meta({ id: "ConvexQueryRequest" });

const fetchAlertsResponseSchema = z
  .object({
    status: convexStatusSchema,
    value: z.array(convexAlertRecordSchema).optional(),
    errorMessage: z.string().optional(),
  })
  .meta({ id: "ConvexFetchAlertsResponse" });

const fetchAlertResponseSchema = z
  .object({
    status: convexStatusSchema,
    value: z.union([convexAlertRecordSchema, z.null()]).optional(),
    errorMessage: z.string().optional(),
  })
  .meta({ id: "ConvexFetchAlertResponse" });

const fetchFixesResponseSchema = z
  .object({
    status: convexStatusSchema,
    value: z.array(convexFixRecordSchema).optional(),
    errorMessage: z.string().optional(),
  })
  .meta({ id: "ConvexFetchFixesResponse" });

const convexQueryResponseSchema = z
  .union([fetchAlertsResponseSchema, fetchAlertResponseSchema, fetchFixesResponseSchema])
  .meta({ id: "ConvexQueryResponse" });

const HealthResponse = healthResponseSchema.meta({ id: "HealthResponse" });
const AuthSessionCreateRequest = authSessionCreateRequestSchema.meta({ id: "AuthSessionCreateRequest" });
const AuthSessionCreateResponse = authSessionCreateResponseSchema.meta({
  id: "AuthSessionCreateResponse",
});
const NotificationPreferencesResponse = notificationPreferencesResponseSchema.meta({
  id: "NotificationPreferencesResponse",
});
const NotificationPreferencesUpdateRequest = notificationPreferencesUpdateRequestSchema.meta({
  id: "NotificationPreferencesUpdateRequest",
});
const PushRegisterRequest = pushRegisterRequestSchema.meta({ id: "PushRegisterRequest" });
const PushRegisterResponse = pushRegisterResponseSchema.meta({ id: "PushRegisterResponse" });
const PushUnregisterRequest = pushUnregisterRequestSchema.meta({ id: "PushUnregisterRequest" });
const PushUnregisterResponse = pushUnregisterResponseSchema.meta({ id: "PushUnregisterResponse" });

function jsonContent(schema: z.ZodTypeAny) {
  return {
    "application/json": {
      schema,
    },
  };
}

function jsonResponse(description: string, schema: z.ZodTypeAny) {
  return {
    description,
    content: jsonContent(schema),
  };
}

registry.registerPath({
  method: "post",
  path: "/query",
  operationId: "query",
  tags: ["convexQuery"],
  summary: "Perform a typed Convex query request",
  request: {
    body: {
      required: true,
      content: jsonContent(convexQueryRequestSchema),
    },
  },
  responses: {
    200: jsonResponse("Convex query response.", convexQueryResponseSchema),
  },
});

registry.registerPath({
  method: "get",
  path: "/health",
  operationId: "fetchHealthSummary",
  tags: ["health"],
  summary: "Fetch the cluster health payload",
  responses: {
    200: jsonResponse("The cluster health payload.", HealthResponse),
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/session",
  operationId: "createAuthSession",
  tags: ["auth"],
  summary: "Exchange a fresh Apple identity token for an app session",
  request: {
    body: {
      required: true,
      content: jsonContent(AuthSessionCreateRequest),
    },
  },
  responses: {
    200: jsonResponse("The app session payload.", AuthSessionCreateResponse),
  },
});

registry.registerPath({
  method: "post",
  path: "/push/register",
  operationId: "registerPushDevice",
  tags: ["push"],
  summary: "Register or refresh an iOS push device token",
  request: {
    body: {
      required: true,
      content: jsonContent(PushRegisterRequest),
    },
  },
  responses: {
    200: jsonResponse("The device registration result.", PushRegisterResponse),
  },
});

registry.registerPath({
  method: "post",
  path: "/push/unregister",
  operationId: "unregisterPushDevice",
  tags: ["push"],
  summary: "Disable an existing push device token",
  request: {
    body: {
      required: true,
      content: jsonContent(PushUnregisterRequest),
    },
  },
  responses: {
    200: jsonResponse("The device unregistration result.", PushUnregisterResponse),
  },
});

registry.registerPath({
  method: "get",
  path: "/me/notification-preferences",
  operationId: "getNotificationPreferences",
  tags: ["notifications"],
  summary: "Fetch the current account-scoped notification preferences",
  responses: {
    200: jsonResponse("The account notification preferences.", NotificationPreferencesResponse),
  },
});

registry.registerPath({
  method: "put",
  path: "/me/notification-preferences",
  operationId: "updateNotificationPreferences",
  tags: ["notifications"],
  summary: "Update the current account-scoped notification preferences",
  request: {
    body: {
      required: true,
      content: jsonContent(NotificationPreferencesUpdateRequest),
    },
  },
  responses: {
    200: jsonResponse("The updated account notification preferences.", NotificationPreferencesResponse),
  },
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const outputPath = resolve(
  repoRoot,
  "ios",
  "OpenAPITools",
  "Sources",
  "CowtailGeneratedAPI",
  "openapi.json",
);

const generator = new OpenApiGeneratorV3(registry.definitions);
const document = generator.generateDocument({
  openapi: "3.0.3",
  info: {
    title: "Cowtail iOS API",
    version: "1.0.0",
    description: "Generated from the working Cowtail iOS transport contract.",
  },
  servers: [
    {
      url: "/api",
      description: "Generic API base shared by the generated clients.",
    },
  ],
});

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
console.log(`Wrote ${outputPath}`);
