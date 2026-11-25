import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from "jose";

export class OidcError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "OidcError";
    this.statusCode = statusCode;
  }
}

export type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  ownerSubject: string;
  displayName: string;
};

const REQUIRED_ENV = [
  "OIDC_ISSUER_URL",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "COWTAIL_OWNER_OIDC_SUBJECT",
] as const;

// All four variables are set or none are. `null` means OIDC sign-in is off; a partial or
// invalid configuration throws a 500 naming what is wrong.
export function oidcConfig(): OidcConfig | null {
  const values = REQUIRED_ENV.map((name) => process.env[name]?.trim() ?? "");
  const missing = REQUIRED_ENV.filter((_, index) => !values[index]);
  if (missing.length === REQUIRED_ENV.length) {
    return null;
  }
  if (missing.length > 0) {
    throw new OidcError(`OIDC sign-in is partially configured; missing ${missing.join(", ")}`, 500);
  }

  const [issuer, clientId, clientSecret, ownerSubject] = values;
  if (!issuer.startsWith("https://")) {
    throw new OidcError("OIDC_ISSUER_URL must be an https URL", 500);
  }

  return {
    issuer,
    clientId,
    clientSecret,
    ownerSubject,
    displayName: process.env.OIDC_DISPLAY_NAME?.trim() || "Pocket ID",
  };
}

export type OidcDiscovery = {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
};

export async function fetchOidcDiscovery(config: OidcConfig): Promise<OidcDiscovery> {
  const url = `${config.issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
  const document = await fetchJson(url, { headers: { accept: "application/json" } });
  const endpoints = {
    authorizationEndpoint: document.authorization_endpoint,
    tokenEndpoint: document.token_endpoint,
    jwksUri: document.jwks_uri,
  };
  if (
    document.issuer !== config.issuer ||
    !Object.values(endpoints).every((value) => typeof value === "string" && value)
  ) {
    throw new OidcError("OIDC discovery document is invalid", 502);
  }

  return endpoints as OidcDiscovery;
}

// client_secret_basic: RFC 6749 §2.3.1 form-encodes the id and secret before base64.
export async function exchangeOidcCode(
  config: OidcConfig,
  discovery: OidcDiscovery,
  { code, codeVerifier, redirectUri }: { code: string; codeVerifier: string; redirectUri: string },
) {
  return await exchangeOidcGrant(config, discovery, {
    grant_type: "authorization_code",
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
  });
}

export async function refreshOidcGrant(
  config: OidcConfig,
  discovery: OidcDiscovery,
  refreshToken: string,
) {
  return await exchangeOidcGrant(config, discovery, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

async function exchangeOidcGrant(
  config: OidcConfig,
  discovery: OidcDiscovery,
  form: Record<string, string>,
) {
  const credentials = btoa(
    `${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`,
  );
  const tokens = await fetchJson(
    discovery.tokenEndpoint,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Basic ${credentials}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(form),
    },
    form.grant_type === "authorization_code"
      ? "OIDC provider refused the authorization code"
      : undefined,
    form.grant_type === "refresh_token",
  );
  if (typeof tokens.id_token !== "string" || !tokens.id_token) {
    throw new OidcError("OIDC token response has no id_token", 502);
  }

  return {
    idToken: tokens.id_token,
    refreshToken:
      typeof tokens.refresh_token === "string" && tokens.refresh_token
        ? tokens.refresh_token
        : undefined,
  };
}

const REJECTED_TOKEN_ERRORS = [
  joseErrors.JWTExpired,
  joseErrors.JWTInvalid,
  joseErrors.JWTClaimValidationFailed,
  joseErrors.JWSSignatureVerificationFailed,
  joseErrors.JWSInvalid,
  joseErrors.JOSEAlgNotAllowed,
  joseErrors.JWKSNoMatchingKey,
  joseErrors.JWKSMultipleMatchingKeys,
];

const jwksByUri = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function verifyOidcIdToken(
  config: OidcConfig,
  discovery: OidcDiscovery,
  { idToken, nonce }: { idToken: string; nonce?: string },
): Promise<string> {
  let jwks = jwksByUri.get(discovery.jwksUri);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(discovery.jwksUri));
    jwksByUri.set(discovery.jwksUri, jwks);
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, jwks, {
      issuer: config.issuer,
      audience: config.clientId,
      requiredClaims: nonce === undefined ? ["exp", "sub"] : ["exp", "sub", "nonce"],
    }));
  } catch (error) {
    if (REJECTED_TOKEN_ERRORS.some((type) => error instanceof type)) {
      throw new OidcError("OIDC ID token verification failed", 401);
    }
    throw new OidcError("OIDC ID token verification is temporarily unavailable", 502);
  }

  if (
    (nonce !== undefined && payload.nonce !== nonce) ||
    typeof payload.sub !== "string" ||
    !payload.sub
  ) {
    throw new OidcError("OIDC ID token verification failed", 401);
  }

  return payload.sub;
}

// A 4xx answer is the provider refusing this request (`refusedMessage`, 401) when the caller
// names one; anything else unexpected is the provider failing (502).
async function fetchJson(
  url: string,
  init: RequestInit,
  refusedMessage?: string,
  isRefreshGrant = false,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new OidcError("OIDC provider is unreachable", 502);
  }

  const body = await response.json().catch(() => null);
  if (isRefreshGrant && response.status === 400 && body?.error === "invalid_grant") {
    throw new OidcError("Pocket ID renewal credential was refused", 401);
  }
  if (refusedMessage && response.status >= 400 && response.status < 500) {
    throw new OidcError(refusedMessage, 401);
  }
  if (!response.ok || !body || typeof body !== "object") {
    throw new OidcError(`OIDC provider returned HTTP ${response.status}`, 502);
  }

  return body as Record<string, unknown>;
}
