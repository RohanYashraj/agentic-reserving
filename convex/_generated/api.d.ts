/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auditLogs from "../auditLogs.js";
import type * as http from "../http.js";
import type * as lib_auditChain from "../lib/auditChain.js";
import type * as lib_clerkWebhook from "../lib/clerkWebhook.js";
import type * as lib_engineClient from "../lib/engineClient.js";
import type * as lib_engineContract from "../lib/engineContract.js";
import type * as lib_guards from "../lib/guards.js";
import type * as lib_schemaContract from "../lib/schemaContract.js";
import type * as lib_triangleParse from "../lib/triangleParse.js";
import type * as triangles from "../triangles.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auditLogs: typeof auditLogs;
  http: typeof http;
  "lib/auditChain": typeof lib_auditChain;
  "lib/clerkWebhook": typeof lib_clerkWebhook;
  "lib/engineClient": typeof lib_engineClient;
  "lib/engineContract": typeof lib_engineContract;
  "lib/guards": typeof lib_guards;
  "lib/schemaContract": typeof lib_schemaContract;
  "lib/triangleParse": typeof lib_triangleParse;
  triangles: typeof triangles;
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
