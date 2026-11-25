import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  OpenApiGeneratorV3,
  OpenAPIRegistry,
  zodToOpenAPIRegistry,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

import {
  alertHumanActionRequestSchema,
  alertListQuerySchema,
  alertListResponseSchema,
  alertRecordSchema,
  alertHumanActionResponseSchema,
  authLogoutResponseSchema,
  authOidcHandoffRequestSchema,
  authOidcHandoffResponseSchema,
  authProvidersResponseSchema,
  authSessionCreateRequestSchema,
  authSessionCreateResponseSchema,
  fixListQuerySchema,
  fixListResponseSchema,
  fixRecordSchema,
  healthResponseSchema,
  hermesRecentAnswerSchema,
  hermesStatusCronJobSchema,
  hermesStatusIncidentSchema,
  hermesStatusResponseSchema,
  incidentAddItemRequestSchema,
  incidentCandidatesResponseSchema,
  incidentEventRecordSchema,
  incidentGetResponseSchema,
  incidentRecordSchema,
  incidentSummarySchema,
  investigationEvidenceStepSchema,
  itemActionQuerySchema,
  itemActionRequestSchema,
  itemActionSchema,
  itemAvailableActionSchema,
  itemEventRecordSchema,
  itemGetResponseSchema,
  itemGraphQuerySchema,
  itemGraphResponseSchema,
  itemInboxResponseSchema,
  itemListQuerySchema,
  itemListResponseSchema,
  itemRecordSchema,
  itemResponseSchema,
  itemSourcesResponseSchema,
  itemStatsQuerySchema,
  itemStatsResponseSchema,
  maintenanceWindowListResponseSchema,
  maintenanceWindowRecordSchema,
  maintenanceWindowResponseSchema,
  maintenanceWindowStartRequestSchema,
  snoozeOptionsQuerySchema,
  snoozeOptionsResponseSchema,
  notificationPreferencesResponseSchema,
  notificationPreferencesUpdateRequestSchema,
  pushRegisterRequestSchema,
  pushRegisterResponseSchema,
  pushUnregisterRequestSchema,
  pushUnregisterResponseSchema,
  priorOccurrenceSchema,
  runbookRunGetResponseSchema,
  runbookRunRecordSchema,
  runbookRunRequestSchema,
  runbookRunResponseSchema,
  runbookSectionSchema,
  runbookStatusScriptSchema,
  userDevicesResponseSchema,
} from "../src/index.ts";

const registry = new OpenAPIRegistry();
// Registered by identity, so every response that holds an item or event refers to one type.
zodToOpenAPIRegistry.add(itemRecordSchema, { _internal: { refId: "ItemRecord" } });
zodToOpenAPIRegistry.add(itemActionSchema, { _internal: { refId: "ItemAction" } });
zodToOpenAPIRegistry.add(itemAvailableActionSchema, {
  _internal: { refId: "ItemAvailableAction" },
});
zodToOpenAPIRegistry.add(itemEventRecordSchema, { _internal: { refId: "ItemEventRecord" } });
zodToOpenAPIRegistry.add(investigationEvidenceStepSchema, {
  _internal: { refId: "InvestigationEvidenceStep" },
});
zodToOpenAPIRegistry.add(priorOccurrenceSchema, { _internal: { refId: "PriorOccurrence" } });
// An item's incident chip, an incident row and the incident page decode these.
zodToOpenAPIRegistry.add(incidentSummarySchema, { _internal: { refId: "IncidentSummary" } });
zodToOpenAPIRegistry.add(incidentRecordSchema, { _internal: { refId: "IncidentRecord" } });
zodToOpenAPIRegistry.add(incidentEventRecordSchema, {
  _internal: { refId: "IncidentEventRecord" },
});

const nonEmptyStringSchema = z.string().trim().min(1);

// Alert and fix records are named types, so the roundup and item detail decode one type each.
zodToOpenAPIRegistry.add(alertRecordSchema, { _internal: { refId: "AlertRecord" } });
zodToOpenAPIRegistry.add(fixRecordSchema, { _internal: { refId: "FixRecord" } });
const AlertListResponse = alertListResponseSchema.meta({ id: "AlertListResponse" });
const FixListResponse = fixListResponseSchema.meta({ id: "FixListResponse" });

const HealthResponse = healthResponseSchema.meta({ id: "HealthResponse" });

// The Hermes tab's rows are named types.
zodToOpenAPIRegistry.add(hermesStatusCronJobSchema, { _internal: { refId: "HermesCronJob" } });
zodToOpenAPIRegistry.add(hermesStatusIncidentSchema, { _internal: { refId: "HermesIncident" } });
zodToOpenAPIRegistry.add(hermesRecentAnswerSchema, { _internal: { refId: "HermesRecentAnswer" } });
zodToOpenAPIRegistry.add(runbookSectionSchema, { _internal: { refId: "RunbookSection" } });
zodToOpenAPIRegistry.add(runbookStatusScriptSchema, { _internal: { refId: "RunbookScript" } });
zodToOpenAPIRegistry.add(runbookRunRecordSchema, { _internal: { refId: "RunbookRun" } });
const HermesStatusResponse = hermesStatusResponseSchema.meta({ id: "HermesStatusResponse" });
const RunbookRunRequest = runbookRunRequestSchema.meta({ id: "RunbookRunRequest" });
const RunbookRunResponse = runbookRunResponseSchema.meta({ id: "RunbookRunResponse" });
const RunbookRunGetResponse = runbookRunGetResponseSchema.meta({ id: "RunbookRunGetResponse" });
const AuthSessionCreateRequest = authSessionCreateRequestSchema.meta({
  id: "AuthSessionCreateRequest",
});
const AuthSessionCreateResponse = authSessionCreateResponseSchema.meta({
  id: "AuthSessionCreateResponse",
});
const AuthProvidersResponse = authProvidersResponseSchema.meta({ id: "AuthProvidersResponse" });
const AuthOidcHandoffRequest = authOidcHandoffRequestSchema.meta({
  id: "AuthOidcHandoffRequest",
});
const AuthOidcHandoffResponse = authOidcHandoffResponseSchema.meta({
  id: "AuthOidcHandoffResponse",
});
const AuthLogoutResponse = authLogoutResponseSchema.meta({ id: "AuthLogoutResponse" });
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
const AlertHumanActionRequest = alertHumanActionRequestSchema.meta({
  id: "AlertHumanActionRequest",
});
const AlertHumanActionResponse = alertHumanActionResponseSchema.meta({
  id: "AlertHumanActionResponse",
});
const ItemActionRequest = itemActionRequestSchema.meta({ id: "ItemActionRequest" });
const ItemResponse = itemResponseSchema.meta({ id: "ItemResponse" });
const ItemListResponse = itemListResponseSchema.meta({ id: "ItemListResponse" });
const ItemInboxResponse = itemInboxResponseSchema.meta({ id: "ItemInboxResponse" });
const ItemGetResponse = itemGetResponseSchema.meta({ id: "ItemGetResponse" });
const ItemGraphResponse = itemGraphResponseSchema.meta({ id: "ItemGraphResponse" });
const ItemStatsResponse = itemStatsResponseSchema.meta({ id: "ItemStatsResponse" });
const SnoozeOptionsResponse = snoozeOptionsResponseSchema.meta({ id: "SnoozeOptionsResponse" });
const ItemSourcesResponse = itemSourcesResponseSchema.meta({ id: "ItemSourcesResponse" });
const UserDevicesResponse = userDevicesResponseSchema.meta({ id: "UserDevicesResponse" });
// The banner and the start sheet decode one window type.
zodToOpenAPIRegistry.add(maintenanceWindowRecordSchema, {
  _internal: { refId: "MaintenanceWindowRecord" },
});
const MaintenanceWindowStartRequest = maintenanceWindowStartRequestSchema.meta({
  id: "MaintenanceWindowStartRequest",
});
const MaintenanceWindowResponse = maintenanceWindowResponseSchema.meta({
  id: "MaintenanceWindowResponse",
});
const MaintenanceWindowListResponse = maintenanceWindowListResponseSchema.meta({
  id: "MaintenanceWindowListResponse",
});
const IncidentGetResponse = incidentGetResponseSchema.meta({ id: "IncidentGetResponse" });
const IncidentCandidatesResponse = incidentCandidatesResponseSchema.meta({
  id: "IncidentCandidatesResponse",
});
const IncidentAddItemRequest = incidentAddItemRequestSchema.meta({ id: "IncidentAddItemRequest" });
const ErrorResponse = z
  .object({
    ok: z.literal(false),
    error: nonEmptyStringSchema,
  })
  .meta({ id: "ErrorResponse" });
registry.registerComponent("securitySchemes", "appSession", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "Cowtail app session",
});

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
  method: "get",
  path: "/alerts",
  operationId: "listAlerts",
  tags: ["alerts"],
  summary: "List alerts in a time range, for the roundup",
  security: [{ appSession: [] }],
  request: { query: alertListQuerySchema },
  responses: {
    200: jsonResponse("The matching alerts.", AlertListResponse),
    400: jsonResponse("Invalid filter.", ErrorResponse),
    401: jsonResponse("App session required.", ErrorResponse),
    403: jsonResponse("Cowtail owner access required.", ErrorResponse),
  },
});

registry.registerPath({
  method: "get",
  path: "/fixes",
  operationId: "listFixes",
  tags: ["alerts"],
  summary: "List fixes in a time range, for the roundup",
  security: [{ appSession: [] }],
  request: { query: fixListQuerySchema },
  responses: {
    200: jsonResponse("The matching fixes.", FixListResponse),
    400: jsonResponse("Invalid filter.", ErrorResponse),
    401: jsonResponse("App session required.", ErrorResponse),
    403: jsonResponse("Cowtail owner access required.", ErrorResponse),
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
  method: "get",
  path: "/auth/providers",
  operationId: "getAuthProviders",
  tags: ["auth"],
  summary: "List the sign-in methods the server accepts",
  responses: {
    200: jsonResponse("The configured sign-in methods.", AuthProvidersResponse),
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/oidc/handoff",
  operationId: "redeemOidcHandoff",
  tags: ["auth"],
  summary: "Redeem an OIDC hand-off code with its PKCE verifier for an app session",
  request: {
    body: {
      required: true,
      content: jsonContent(AuthOidcHandoffRequest),
    },
  },
  responses: {
    200: jsonResponse("The app session payload.", AuthOidcHandoffResponse),
    400: jsonResponse("Invalid hand-off request.", ErrorResponse),
    401: jsonResponse("Unknown, used, expired or mismatched hand-off code.", ErrorResponse),
    404: jsonResponse("OIDC sign-in is not configured.", ErrorResponse),
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/logout",
  operationId: "logout",
  tags: ["auth"],
  summary: "Revoke the current app session",
  security: [{ appSession: [] }],
  responses: {
    200: jsonResponse("The session was revoked.", AuthLogoutResponse),
    401: jsonResponse("App session required.", ErrorResponse),
  },
});

registry.registerPath({
  method: "post",
  path: "/push/register",
  operationId: "registerPushDevice",
  tags: ["push"],
  // The app session, or no bearer and an Apple `identityToken` in the body.
  security: [{ appSession: [] }, {}],
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
  // The app session, or no bearer and an Apple `identityToken` in the body.
  security: [{ appSession: [] }, {}],
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
    200: jsonResponse(
      "The updated account notification preferences.",
      NotificationPreferencesResponse,
    ),
  },
});

registry.registerPath({
  method: "post",
  path: "/me/alerts/{id}/actions",
  operationId: "performAlertAction",
  tags: ["alerts"],
  summary: "Apply an owner disposition or retry an alert investigation",
  security: [{ appSession: [] }],
  request: {
    params: z.object({ id: nonEmptyStringSchema }),
    body: {
      required: true,
      content: jsonContent(AlertHumanActionRequest),
    },
  },
  responses: {
    200: jsonResponse("The updated alert.", AlertHumanActionResponse),
    400: jsonResponse("Invalid owner action request.", ErrorResponse),
    401: jsonResponse("App session required.", ErrorResponse),
    403: jsonResponse("Cowtail owner access required.", ErrorResponse),
    404: jsonResponse("Alert not found.", ErrorResponse),
    409: jsonResponse("Alert workflow state conflict.", ErrorResponse),
  },
});

registry.registerPath({
  method: "post",
  path: "/me/items/{id}/actions",
  operationId: "performItemAction",
  tags: ["items"],
  summary: "Ack, snooze, unsnooze or answer an item",
  security: [{ appSession: [] }],
  request: {
    params: z.object({ id: nonEmptyStringSchema }),
    query: itemActionQuerySchema,
    body: {
      required: true,
      content: jsonContent(ItemActionRequest),
    },
  },
  responses: {
    200: jsonResponse("The item after the action.", ItemResponse),
    400: jsonResponse("Invalid item action.", ErrorResponse),
    401: jsonResponse("App session required.", ErrorResponse),
    403: jsonResponse("Cowtail owner access required.", ErrorResponse),
    404: jsonResponse("Item not found.", ErrorResponse),
    409: jsonResponse(
      "The item is closed, does not offer the action, or is not snoozed.",
      ErrorResponse,
    ),
  },
});

registry.registerPath({
  method: "get",
  path: "/items",
  operationId: "listItems",
  tags: ["items"],
  summary: "List items, newest first, filtered",
  security: [{ appSession: [] }],
  request: { query: itemListQuerySchema },
  responses: {
    200: jsonResponse("A page of items.", ItemListResponse),
    400: jsonResponse("Invalid filter or cursor.", ErrorResponse),
    401: jsonResponse("App session required.", ErrorResponse),
    403: jsonResponse("Cowtail owner access required.", ErrorResponse),
  },
});

registry.registerPath({
  method: "get",
  path: "/me/snooze-options",
  operationId: "getSnoozeOptions",
  tags: ["items"],
  summary: "The snooze picker's preset times in the device's time zone",
  security: [{ appSession: [] }],
  request: { query: snoozeOptionsQuerySchema },
  responses: {
    200: jsonResponse("The presets, in picker order.", SnoozeOptionsResponse),
    400: jsonResponse("Invalid time zone.", ErrorResponse),
    401: jsonResponse("App session required.", ErrorResponse),
    403: jsonResponse("Cowtail owner access required.", ErrorResponse),
  },
});

registry.registerPath({
  method: "get",
  path: "/items/inbox",
  operationId: "getItemInbox",
  tags: ["items"],
  summary: "The owner's inbox: needs you, with Hermes, upcoming, and handled in the last 24 hours",
  security: [{ appSession: [] }],
  responses: {
    200: jsonResponse("The inbox sections.", ItemInboxResponse),
    401: jsonResponse("App session required.", ErrorResponse),
    403: jsonResponse("Cowtail owner access required.", ErrorResponse),
  },
});

registry.registerPath({
  method: "get",
  path: "/items/sources",
  operationId: "listItemSources",
  tags: ["items"],
  summary: "Every source with an item, in name order",
  security: [{ appSession: [] }],
  responses: {
    200: jsonResponse("The sources.", ItemSourcesResponse),
    401: jsonResponse("App session required.", ErrorResponse),
    403: jsonResponse("Cowtail owner access required.", ErrorResponse),
  },
});

registry.registerPath({
  method: "get",
  path: "/items/stats",
  operationId: "getItemStats",
  tags: ["items"],
  summary: "Outcome mix, time to resolve, noise, repeats, daily volume and firing alerts",
  security: [{ appSession: [] }],
  request: { query: itemStatsQuerySchema },
  responses: {
    200: jsonResponse("The item stats.", ItemStatsResponse),
    400: jsonResponse("Invalid range.", ErrorResponse),
    401: jsonResponse("App session required.", ErrorResponse),
    403: jsonResponse("Cowtail owner access required.", ErrorResponse),
  },
});

registry.registerPath({
  method: "get",
  path: "/items/{id}",
  operationId: "getItem",
  tags: ["items"],
  summary: "An item and its timeline",
  security: [{ appSession: [] }],
  request: { params: z.object({ id: nonEmptyStringSchema }) },
  responses: {
    200: jsonResponse("The item and its events.", ItemGetResponse),
    401: jsonResponse("App session required.", ErrorResponse),
    403: jsonResponse("Cowtail owner access required.", ErrorResponse),
    404: jsonResponse("Item not found.", ErrorResponse),
  },
});

registry.registerPath({
  method: "get",
  path: "/items/{id}/graph",
  operationId: "getItemGraph",
  tags: ["items"],
  summary: "An alert item's own metric over 1h, 6h or 24h, with its threshold and firing",
  security: [{ appSession: [] }],
  request: { params: z.object({ id: nonEmptyStringSchema }), query: itemGraphQuerySchema },
  responses: {
    200: jsonResponse("The graph, or why there is none.", ItemGraphResponse),
    400: jsonResponse("Invalid range.", ErrorResponse),
    401: jsonResponse("App session required.", ErrorResponse),
    403: jsonResponse("Cowtail owner access required.", ErrorResponse),
    404: jsonResponse("Item not found.", ErrorResponse),
  },
});

registry.registerPath({
  method: "get",
  path: "/hermes/status",
  operationId: "getHermesStatus",
  tags: ["hermes"],
  summary: "Hermes's latest heartbeat, how alive it looks, and the owner's recent answers",
  security: [{ appSession: [] }],
  responses: {
    200: jsonResponse("The Hermes status.", HermesStatusResponse),
    401: jsonResponse("App session required.", ErrorResponse),
    403: jsonResponse("Cowtail owner access required.", ErrorResponse),
  },
});

registry.registerPath({
  method: "post",
  path: "/me/runbook/runs",
  operationId: "startRunbookRun",
  tags: ["hermes"],
  summary: "Ask Hermes to run a runbook script, optionally for an item",
  security: [{ appSession: [] }],
  request: { body: { required: true, content: jsonContent(RunbookRunRequest) } },
  responses: {
    200: jsonResponse("The queued run.", RunbookRunResponse),
    400: jsonResponse("Invalid request, or the script asks to confirm.", ErrorResponse),
    401: jsonResponse("App session required.", ErrorResponse),
    403: jsonResponse("Owner access, or Face ID for this script, required.", ErrorResponse),
    404: jsonResponse("Unknown script or item.", ErrorResponse),
  },
});

registry.registerPath({
  method: "get",
  path: "/me/runbook/runs/{id}",
  operationId: "getRunbookRun",
  tags: ["hermes"],
  summary: "A runbook run and its output so far",
  security: [{ appSession: [] }],
  request: { params: z.object({ id: nonEmptyStringSchema }) },
  responses: {
    200: jsonResponse("The run and its output.", RunbookRunGetResponse),
    401: jsonResponse("App session required.", ErrorResponse),
    403: jsonResponse("Cowtail owner access required.", ErrorResponse),
    404: jsonResponse("Run not found.", ErrorResponse),
  },
});

registry.registerPath({
  method: "get",
  path: "/me/devices",
  operationId: "listMyDevices",
  tags: ["push"],
  summary: "The signed-in account's enabled push devices",
  security: [{ appSession: [] }],
  responses: {
    200: jsonResponse("The account's devices.", UserDevicesResponse),
    401: jsonResponse("App session required.", ErrorResponse),
  },
});

registry.registerPath({
  method: "get",
  path: "/me/maintenance-windows",
  operationId: "listMaintenanceWindows",
  tags: ["maintenance"],
  summary: "The running maintenance windows and the most recent ones over",
  security: [{ appSession: [] }],
  responses: {
    200: jsonResponse("The windows.", MaintenanceWindowListResponse),
    401: jsonResponse("App session required.", ErrorResponse),
    403: jsonResponse("Cowtail owner access required.", ErrorResponse),
  },
});

registry.registerPath({
  method: "post",
  path: "/me/maintenance-windows",
  operationId: "startMaintenanceWindow",
  tags: ["maintenance"],
  summary: "Start a maintenance window now",
  security: [{ appSession: [] }],
  request: { body: { content: jsonContent(MaintenanceWindowStartRequest) } },
  responses: {
    200: jsonResponse("The started window.", MaintenanceWindowResponse),
    400: jsonResponse("Invalid window.", ErrorResponse),
    401: jsonResponse("App session required.", ErrorResponse),
    403: jsonResponse("Cowtail owner access required.", ErrorResponse),
  },
});

registry.registerPath({
  method: "post",
  path: "/me/maintenance-windows/{id}/end",
  operationId: "endMaintenanceWindow",
  tags: ["maintenance"],
  summary: "End a maintenance window now",
  security: [{ appSession: [] }],
  request: { params: z.object({ id: nonEmptyStringSchema }) },
  responses: {
    200: jsonResponse("The window, over.", MaintenanceWindowResponse),
    401: jsonResponse("App session required.", ErrorResponse),
    403: jsonResponse("Cowtail owner access required.", ErrorResponse),
    404: jsonResponse("Maintenance window not found.", ErrorResponse),
  },
});

const incidentId = z.object({ id: nonEmptyStringSchema });
const incidentErrors = {
  401: jsonResponse("App session required.", ErrorResponse),
  403: jsonResponse("Cowtail owner access required.", ErrorResponse),
  404: jsonResponse("Incident or item not found.", ErrorResponse),
};

registry.registerPath({
  method: "get",
  path: "/incidents/{id}",
  operationId: "getIncident",
  tags: ["incidents"],
  summary: "An incident, its members and the merged timeline",
  security: [{ appSession: [] }],
  request: { params: incidentId },
  responses: { 200: jsonResponse("The incident.", IncidentGetResponse), ...incidentErrors },
});

registry.registerPath({
  method: "get",
  path: "/incidents/{id}/candidates",
  operationId: "listIncidentCandidates",
  tags: ["incidents"],
  summary: "The items the owner can add to an incident",
  security: [{ appSession: [] }],
  request: { params: incidentId },
  responses: { 200: jsonResponse("The items.", IncidentCandidatesResponse), ...incidentErrors },
});

registry.registerPath({
  method: "post",
  path: "/me/incidents/{id}/items",
  operationId: "addIncidentItem",
  tags: ["incidents"],
  summary: "Add an item to an incident",
  security: [{ appSession: [] }],
  request: {
    params: incidentId,
    body: { required: true, content: jsonContent(IncidentAddItemRequest) },
  },
  responses: {
    200: jsonResponse("The incident.", IncidentGetResponse),
    ...incidentErrors,
    409: jsonResponse("The item belongs to another incident.", ErrorResponse),
  },
});

registry.registerPath({
  method: "delete",
  path: "/me/incidents/{id}/items/{itemId}",
  operationId: "removeIncidentItem",
  tags: ["incidents"],
  summary: "Take an item out of an incident",
  security: [{ appSession: [] }],
  request: { params: z.object({ id: nonEmptyStringSchema, itemId: nonEmptyStringSchema }) },
  responses: { 200: jsonResponse("The incident.", IncidentGetResponse), ...incidentErrors },
});

registry.registerPath({
  method: "post",
  path: "/me/incidents/{id}/resolve",
  operationId: "resolveIncident",
  tags: ["incidents"],
  summary: "Resolve an incident now",
  security: [{ appSession: [] }],
  request: { params: incidentId },
  responses: { 200: jsonResponse("The incident.", IncidentGetResponse), ...incidentErrors },
});

registry.registerPath({
  method: "post",
  path: "/me/incidents/{id}/postmortem",
  operationId: "requestIncidentPostmortem",
  tags: ["incidents"],
  summary: "Ask Hermes for the incident's postmortem again",
  security: [{ appSession: [] }],
  request: { params: incidentId },
  responses: {
    200: jsonResponse("The incident.", IncidentGetResponse),
    ...incidentErrors,
    409: jsonResponse("The incident is open, or a postmortem is on its way.", ErrorResponse),
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
