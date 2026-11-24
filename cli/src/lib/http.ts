import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import { errorResponseSchema } from "@maudecode/cowtail-protocol";

import { loadConfig, requireBaseUrl } from "./config.ts";
import { configError, CliError } from "./errors.ts";

type RequestOptions = {
  requireServiceAuth?: boolean;
};

type Method = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

// A body sent as is, such as an image, instead of as JSON.
type RawBody = { bytes: Uint8Array; contentType: string };

type HttpResponse = {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

function buildRequestUrl(baseUrl: string, path: string): string {
  const normalizedPath = path.replace(/^\/+/, "");
  return new URL(normalizedPath, `${baseUrl.replace(/\/+$/, "")}/`).toString();
}

function buildHeaders(requireServiceAuth: boolean) {
  const config = loadConfig();
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (requireServiceAuth) {
    if (!config.pushBearerToken) {
      throw configError(
        `pushBearerToken is required in ${config.configPath} for authenticated commands`,
      );
    }

    headers.authorization = `Bearer ${config.pushBearerToken}`;
  }

  return { config, headers };
}

async function readErrorMessage(response: HttpResponse): Promise<string> {
  const contentType = Array.isArray(response.headers["content-type"])
    ? response.headers["content-type"][0]
    : response.headers["content-type"];

  if (contentType?.toLowerCase().includes("application/json")) {
    try {
      const payload = errorResponseSchema.safeParse(JSON.parse(response.body));
      if (payload.success) {
        return payload.data.error;
      }
    } catch {
      // Fall through to body parsing below.
    }
  }

  const text = response.body.trim();
  return text || response.statusMessage || "Request failed";
}

function requestJson(
  urlString: string,
  options: {
    method: Method;
    body?: string | Uint8Array;
    headers: Record<string, string>;
    timeoutMs: number;
  },
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const requestImpl = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = requestImpl(
      url,
      {
        method: options.method,
        headers: options.body
          ? {
              ...options.headers,
              "content-length": String(Buffer.byteLength(options.body)),
            }
          : options.headers,
      },
      (response) => {
        let responseBody = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            statusMessage: response.statusMessage ?? "",
            headers: response.headers,
            body: responseBody,
          });
        });
      },
    );

    request.setTimeout(options.timeoutMs, () => {
      request.destroy(new CliError(`Request timed out after ${options.timeoutMs}ms`));
    });

    request.on("error", (error) => {
      reject(error);
    });

    if (options.body !== undefined) {
      request.write(options.body);
    }
    request.end();
  });
}

async function requestJsonResponse<T>(
  method: Method,
  path: string,
  body: unknown | undefined,
  options: RequestOptions = {},
  raw?: RawBody,
): Promise<T> {
  const { config, headers } = buildHeaders(Boolean(options.requireServiceAuth));
  const url = buildRequestUrl(requireBaseUrl(config), path);
  const requestBody = raw ? raw.bytes : body === undefined ? undefined : JSON.stringify(body);
  if (raw) headers["content-type"] = raw.contentType;

  let response: HttpResponse;
  try {
    response = await requestJson(url, {
      method,
      body: requestBody,
      headers,
      timeoutMs: config.timeoutMs,
    });
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(`Request failed: ${message}`);
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const message = await readErrorMessage(response);
    throw new CliError(`Request failed (${response.statusCode}): ${message}`);
  }

  try {
    return JSON.parse(response.body) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(`Failed to parse JSON response: ${message}`);
  }
}

export async function postJson<T>(
  path: string,
  body: unknown,
  options: RequestOptions = {},
): Promise<T> {
  return await requestJsonResponse("POST", path, body, options);
}

export async function patchJson<T>(
  path: string,
  body: unknown,
  options: RequestOptions = {},
): Promise<T> {
  return await requestJsonResponse("PATCH", path, body, options);
}

export async function putBytes<T>(
  path: string,
  raw: RawBody,
  options: RequestOptions = {},
): Promise<T> {
  return await requestJsonResponse("PUT", path, undefined, options, raw);
}

export async function getJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return await requestJsonResponse("GET", path, undefined, options);
}

export async function deleteJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return await requestJsonResponse("DELETE", path, undefined, options);
}
