import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import { loadConfig, requireBaseUrl } from "./config";
import { CliError, configError } from "./errors";

export type RealtimeHealthStatus = {
  ok: true;
  url: string;
  statusCode: number;
  body: string;
};

type HealthResponse = {
  statusCode: number;
  statusMessage: string;
  body: string;
};

export function deriveRealtimeHealthUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw configError(`baseUrl must be a valid URL: ${message}`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw configError("baseUrl must use http or https");
  }

  url.pathname = "/healthz";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function loadRealtimeHealthStatus(): Promise<RealtimeHealthStatus> {
  const config = loadConfig();
  return await getRealtimeHealthStatus(requireBaseUrl(config), config.timeoutMs);
}

export async function getRealtimeHealthStatus(
  baseUrl: string,
  timeoutMs: number,
): Promise<RealtimeHealthStatus> {
  const url = deriveRealtimeHealthUrl(baseUrl);
  const response = await requestHealth(url, timeoutMs);

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new CliError(
      `Cowtail Realtime health check failed (${response.statusCode}): ${
        response.body.trim() || response.statusMessage || "Request failed"
      }`,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(response.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(`Failed to parse Cowtail Realtime health response: ${message}`);
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    (payload as { ok?: unknown }).ok !== true
  ) {
    throw new CliError("Cowtail Realtime health response did not report ok");
  }

  return {
    ok: true,
    url,
    statusCode: response.statusCode,
    body: response.body,
  };
}

function requestHealth(urlString: string, timeoutMs: number): Promise<HealthResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const requestImpl = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = requestImpl(
      url,
      {
        method: "GET",
      },
      (response) => {
        let body = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            statusMessage: response.statusMessage ?? "",
            body,
          });
        });
      },
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new CliError(`Request timed out after ${timeoutMs}ms`));
    });

    request.on("error", (error) => {
      reject(error);
    });

    request.end();
  });
}
