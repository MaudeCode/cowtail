/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as alerts from "../alerts.js";
import type * as apns from "../apns.js";
import type * as appleIdentity from "../appleIdentity.js";
import type * as authSessions from "../authSessions.js";
import type * as crons from "../crons.js";
import type * as fixes from "../fixes.js";
import type * as http from "../http.js";
import type * as notificationPreferences from "../notificationPreferences.js";
import type * as openclaw from "../openclaw.js";
import type * as openclawModel from "../openclawModel.js";
import type * as openclawPreferences from "../openclawPreferences.js";
import type * as push from "../push.js";
import type * as pushActions from "../pushActions.js";
import type * as pushDelivery from "../pushDelivery.js";
import type * as roundup from "../roundup.js";
import type * as roundupActions from "../roundupActions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  alerts: typeof alerts;
  apns: typeof apns;
  appleIdentity: typeof appleIdentity;
  authSessions: typeof authSessions;
  crons: typeof crons;
  fixes: typeof fixes;
  http: typeof http;
  notificationPreferences: typeof notificationPreferences;
  openclaw: typeof openclaw;
  openclawModel: typeof openclawModel;
  openclawPreferences: typeof openclawPreferences;
  push: typeof push;
  pushActions: typeof pushActions;
  pushDelivery: typeof pushDelivery;
  roundup: typeof roundup;
  roundupActions: typeof roundupActions;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
