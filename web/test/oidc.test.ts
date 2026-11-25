import { createHash, randomBytes } from "node:crypto";

import {
  authOidcHandoffResponseSchema,
  authProvidersResponseSchema,
  authSessionCreateResponseSchema,
} from "@maudecode/cowtail-protocol";
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { advance, newBackend, stubEnv, type Backend } from "./convexHarness";

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const ISSUER = "https://id.test";
const WEB_ORIGIN = "https://cowtail.test";
const CLIENT_ID = "cowtail-client";
const CLIENT_SECRET = "cowtail-secret";
const OWNER_SUBJECT = "pocket-owner-sub";
const OWNER_USER_ID = "apple-owner-sub";
const APPLE_AUDIENCE = "com.example.cowtail";
const OIDC_ENV = {
  OIDC_ISSUER_URL: ISSUER,
  OIDC_CLIENT_ID: CLIENT_ID,
  OIDC_CLIENT_SECRET: CLIENT_SECRET,
  COWTAIL_OWNER_OIDC_SUBJECT: OWNER_SUBJECT,
};

const signingKey = await generateKeyPair("RS256");
const publicJwk = { ...(await exportJWK(signingKey.publicKey)), kid: "test-key", alg: "RS256" };

function s256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function signIdToken(claims: JWTPayload) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuedAt()
    .sign(signingKey.privateKey);
}

type IdTokenClaims = Partial<Pick<JWTPayload, "iss" | "aud" | "sub" | "exp">> & { nonce?: string };

// The provider side of the authorization-code flow. Codes are keyed by value, and the
// token endpoint enforces client_secret_basic, the redirect URI and the PKCE verifier.
function fakeOidcProvider() {
  const grants = new Map<string, { challenge: string; idToken: string }>();
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === `${ISSUER}/.well-known/openid-configuration`) {
        return Response.json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/authorize`,
          token_endpoint: `${ISSUER}/token`,
          jwks_uri: `${ISSUER}/jwks`,
        });
      }
      if (url === `${ISSUER}/jwks` || url === "https://appleid.apple.com/auth/keys") {
        return Response.json({ keys: [publicJwk] });
      }
      if (url === `${ISSUER}/token`) {
        const form = new URLSearchParams(String(init?.body));
        const grant = grants.get(form.get("code") ?? "");
        grants.delete(form.get("code") ?? "");
        const basic = `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`;
        if (
          !grant ||
          new Headers(init?.headers).get("authorization") !== basic ||
          form.get("grant_type") !== "authorization_code" ||
          form.get("redirect_uri") !== `${WEB_ORIGIN}/actions/api/auth/oidc/callback` ||
          s256(form.get("code_verifier") ?? "") !== grant.challenge
        ) {
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        }
        return Response.json({ access_token: "at", token_type: "Bearer", id_token: grant.idToken });
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );

  // The user signs in at the provider: issue a code for the authorize request Cowtail sent.
  async function authorize(location: string, claims: IdTokenClaims = {}) {
    const params = new URL(location).searchParams;
    const code = randomBytes(16).toString("hex");
    grants.set(code, {
      challenge: params.get("code_challenge") ?? "",
      idToken: await signIdToken({
        iss: ISSUER,
        aud: CLIENT_ID,
        sub: OWNER_SUBJECT,
        exp: Math.floor(Date.now() / 1000) + 300,
        nonce: params.get("nonce") ?? undefined,
        ...claims,
      }),
    });
    return { code, state: params.get("state") ?? "" };
  }

  return { authorize };
}

async function get(t: Backend, path: string, headers: Record<string, string> = {}) {
  return await t.fetch(path, { headers });
}

async function startLogin(t: Backend, query: string) {
  const response = await get(t, `/api/auth/oidc/start?${query}`);
  expect(response.status).toBe(302);
  return response.headers.get("location") ?? "";
}

async function callback(t: Backend, { code, state }: { code: string; state: string }) {
  return await get(
    t,
    `/api/auth/oidc/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
  );
}

function sessionCookie(response: Response): string {
  const cookie = response.headers.get("set-cookie") ?? "";
  return cookie.split(";")[0];
}

async function sessionCount(t: Backend) {
  return (await t.run((ctx) => ctx.db.query("authSessions").collect())).length;
}

let provider: ReturnType<typeof fakeOidcProvider>;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  stubEnv({ ...OIDC_ENV, COWTAIL_OWNER_USER_ID: OWNER_USER_ID, COWTAIL_WEB_ORIGIN: WEB_ORIGIN });
  provider = fakeOidcProvider();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function webSignIn(t: Backend) {
  const location = await startLogin(t, "client=web");
  return await callback(t, await provider.authorize(location));
}

async function iosSignIn(t: Backend, verifier: string) {
  const location = await startLogin(t, `client=ios&handoff_challenge=${s256(verifier)}`);
  const response = await callback(t, await provider.authorize(location));
  expect(response.status).toBe(302);
  return new URL(response.headers.get("location") ?? "").searchParams.get("code") ?? "";
}

async function handoff(t: Backend, code: string, verifier: string) {
  return await t.fetch("/api/auth/oidc/handoff", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, verifier }),
  });
}

test("the start route sends the browser to the provider with PKCE, state and nonce", async () => {
  const t = newBackend();
  const location = new URL(await startLogin(t, "client=web"));

  expect(`${location.origin}${location.pathname}`).toBe(`${ISSUER}/authorize`);
  expect(Object.fromEntries(location.searchParams)).toMatchObject({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: `${WEB_ORIGIN}/actions/api/auth/oidc/callback`,
    scope: "openid profile email",
    code_challenge_method: "S256",
  });
  for (const param of ["state", "nonce", "code_challenge"]) {
    expect(location.searchParams.get(param)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  }
});

test("a web sign-in sets an owner session cookie and redirects home", async () => {
  const t = newBackend();
  const response = await webSignIn(t);

  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/");
  const cookie = response.headers.get("set-cookie") ?? "";
  expect(cookie).toMatch(/^cowtail_session=[0-9a-f]{64};/);
  expect(cookie.split("; ")).toEqual(
    expect.arrayContaining(["Max-Age=2592000", "Path=/", "HttpOnly", "Secure", "SameSite=Lax"]),
  );
  const sessions = await t.run((ctx) => ctx.db.query("authSessions").collect());
  expect(sessions.map((session) => session.userId)).toEqual([OWNER_USER_ID]);
});

test.each([
  { name: "cookie GET", method: "GET", cookie: true, origin: undefined, status: 200 },
  {
    name: "cookie PUT from the web origin",
    method: "PUT",
    cookie: true,
    origin: WEB_ORIGIN,
    status: 200,
  },
  {
    name: "cookie PUT from a foreign origin",
    method: "PUT",
    cookie: true,
    origin: "https://evil.test",
    status: 403,
  },
  {
    name: "cookie PUT with no origin",
    method: "PUT",
    cookie: true,
    origin: undefined,
    status: 403,
  },
  {
    name: "bearer PUT with no origin",
    method: "PUT",
    cookie: false,
    origin: undefined,
    status: 200,
  },
])("an app route answers a $name with $status", async ({ method, cookie, origin, status }) => {
  const t = newBackend();
  const signIn = await webSignIn(t);
  const token = sessionCookie(signIn).split("=")[1];
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = `cowtail_session=${token}`;
  else headers.authorization = `Bearer ${token}`;
  if (origin) headers.origin = origin;

  const response = await t.fetch("/api/me/notification-preferences", {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify({ dailyRoundupEnabled: true }),
  });
  expect(response.status).toBe(status);
});

test("an iOS sign-in hands the app a code that its verifier redeems for an owner session", async () => {
  const t = newBackend();
  const verifier = randomBytes(32).toString("base64url");
  const location = await startLogin(t, `client=ios&handoff_challenge=${s256(verifier)}`);
  const response = await callback(t, await provider.authorize(location));

  expect(response.status).toBe(302);
  const appLink = new URL(response.headers.get("location") ?? "");
  expect(`${appLink.protocol}//${appLink.host}${appLink.pathname}`).toBe("cowtail://auth/callback");
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(await sessionCount(t)).toBe(0);

  const redeemed = await handoff(t, appLink.searchParams.get("code") ?? "", verifier);
  expect(redeemed.status).toBe(200);
  const { session } = authOidcHandoffResponseSchema.parse(await redeemed.json());
  expect(session.userId).toBe(OWNER_USER_ID);
  const me = await get(t, "/api/me/notification-preferences", {
    authorization: `Bearer ${session.token}`,
  });
  expect(me.status).toBe(200);
});

test("the iOS start route requires a hand-off challenge", async () => {
  const t = newBackend();
  const response = await get(t, "/api/auth/oidc/start?client=ios");
  expect(response.status).toBe(400);
});

test("the start route refuses new logins while 20 are pending, until they expire", async () => {
  const t = newBackend();
  for (let index = 0; index < 20; index += 1) await startLogin(t, "client=web");

  const refused = await get(t, "/api/auth/oidc/start?client=web");
  expect(refused.status).toBe(429);
  expect(await t.run((ctx) => ctx.db.query("oidcLogins").collect())).toHaveLength(20);

  await advance(t, 10 * 60_000);
  await startLogin(t, "client=web");
});

test.each([
  { name: "a second time", redeemTwice: true, wrongVerifier: false, waitMs: 0 },
  { name: "with the wrong verifier", redeemTwice: false, wrongVerifier: true, waitMs: 0 },
  { name: "after 60 seconds", redeemTwice: false, wrongVerifier: false, waitMs: 60_000 },
])("a hand-off code redeemed $name is refused", async ({ redeemTwice, wrongVerifier, waitMs }) => {
  const t = newBackend();
  const verifier = randomBytes(32).toString("base64url");
  const code = await iosSignIn(t, verifier);
  if (redeemTwice) expect((await handoff(t, code, verifier)).status).toBe(200);
  await advance(t, waitMs);

  const sessionsBefore = await sessionCount(t);
  const presented = wrongVerifier ? randomBytes(32).toString("base64url") : verifier;
  const response = await handoff(t, code, presented);
  expect(response.status).toBe(401);
  expect(await sessionCount(t)).toBe(sessionsBefore);
});

test.each([
  { name: "an unknown", reuse: false, waitMs: 0, forge: true },
  { name: "a reused", reuse: true, waitMs: 0, forge: false },
  { name: "an expired", reuse: false, waitMs: 10 * 60_000, forge: false },
])("a callback with $name state is refused", async ({ reuse, waitMs, forge }) => {
  const t = newBackend();
  const grant = await provider.authorize(await startLogin(t, "client=web"));
  if (reuse) expect((await callback(t, grant)).status).toBe(302);
  await advance(t, waitMs);

  const sessionsBefore = await sessionCount(t);
  const state = forge ? randomBytes(32).toString("base64url") : grant.state;
  const response = await callback(t, { code: grant.code, state });
  expect(response.status).toBe(400);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(await sessionCount(t)).toBe(sessionsBefore);
});

test.each([
  { name: "a wrong nonce", claims: { nonce: "not-the-login-nonce" } },
  { name: "a wrong audience", claims: { aud: "another-client" } },
  { name: "a wrong issuer", claims: { iss: "https://other-id.test" } },
  { name: "an expired ID token", claims: { exp: Math.floor(NOW / 1000) - 60 } },
])("an ID token with $name is refused", async ({ claims }) => {
  const t = newBackend();
  const location = await startLogin(t, "client=web");
  const response = await callback(t, await provider.authorize(location, claims));

  expect(response.status).toBe(401);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(await sessionCount(t)).toBe(0);
});

test("a Pocket ID user other than the owner gets 403 and no session", async () => {
  const t = newBackend();
  const location = await startLogin(t, "client=web");
  const response = await callback(t, await provider.authorize(location, { sub: "someone-else" }));

  expect(response.status).toBe(403);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(await sessionCount(t)).toBe(0);
});

test("with OIDC unset, providers list only Apple and the OIDC routes are not found", async () => {
  const t = newBackend();
  for (const name of Object.keys(OIDC_ENV)) vi.stubEnv(name, "");

  const providers = await get(t, "/api/auth/providers");
  expect(authProvidersResponseSchema.parse(await providers.json())).toEqual({
    apple: true,
    appleWeb: false,
  });
  expect((await get(t, "/api/auth/oidc/start?client=web")).status).toBe(404);
  expect((await get(t, "/api/auth/oidc/callback?code=c&state=s")).status).toBe(404);
  expect((await handoff(t, "code", "v".repeat(43))).status).toBe(404);
});

test("with OIDC fully set, providers offer it under its display name", async () => {
  const t = newBackend();
  stubEnv({ OIDC_DISPLAY_NAME: "Home ID" });

  const providers = await get(t, "/api/auth/providers");
  expect(authProvidersResponseSchema.parse(await providers.json())).toEqual({
    apple: true,
    appleWeb: false,
    oidc: { name: "Home ID" },
  });
});

test("a partial OIDC configuration fails every OIDC route naming what is missing", async () => {
  const t = newBackend();
  stubEnv({ OIDC_CLIENT_SECRET: "", COWTAIL_OWNER_OIDC_SUBJECT: "" });

  const responses = [
    await get(t, "/api/auth/oidc/start?client=web"),
    await get(t, "/api/auth/oidc/callback?code=c&state=s"),
    await handoff(t, "code", "v".repeat(43)),
  ];
  for (const response of responses) {
    expect(response.status).toBe(500);
    expect(await response.text()).toContain("OIDC_CLIENT_SECRET, COWTAIL_OWNER_OIDC_SUBJECT");
  }
  const providers = await get(t, "/api/auth/providers");
  expect(authProvidersResponseSchema.parse(await providers.json())).toEqual({
    apple: true,
    appleWeb: false,
  });
});

test("logout revokes the cookie session and clears the cookie", async () => {
  const t = newBackend();
  const cookie = sessionCookie(await webSignIn(t));

  const logout = await t.fetch("/api/auth/logout", {
    method: "POST",
    headers: { cookie, origin: WEB_ORIGIN },
  });
  expect(logout.status).toBe(200);
  expect(logout.headers.get("set-cookie")).toMatch(/^cowtail_session=; Max-Age=0;/);
  const after = await get(t, "/api/me/notification-preferences", { cookie });
  expect(after.status).toBe(401);
});

test("logout revokes a bearer session", async () => {
  const t = newBackend();
  const verifier = randomBytes(32).toString("base64url");
  const redeemed = await handoff(t, await iosSignIn(t, verifier), verifier);
  const { session } = authOidcHandoffResponseSchema.parse(await redeemed.json());
  const authorization = `Bearer ${session.token}`;

  expect(
    (await t.fetch("/api/auth/logout", { method: "POST", headers: { authorization } })).status,
  ).toBe(200);
  expect((await get(t, "/api/me/notification-preferences", { authorization })).status).toBe(401);
});

test("Sign in with Apple still issues a working app session", async () => {
  const t = newBackend();
  stubEnv({ APPLE_AUTH_AUDIENCE: APPLE_AUDIENCE });
  const identityToken = await signIdToken({
    iss: "https://appleid.apple.com",
    aud: APPLE_AUDIENCE,
    sub: OWNER_USER_ID,
    exp: Math.floor(NOW / 1000) + 300,
  });

  const response = await t.fetch("/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identityToken }),
  });
  expect(response.status).toBe(200);
  const { session } = authSessionCreateResponseSchema.parse(await response.json());
  expect(session).toMatchObject({ userId: OWNER_USER_ID, expiresAt: NOW + 2_592_000_000 });
  const me = await get(t, "/api/me/notification-preferences", {
    authorization: `Bearer ${session.token}`,
  });
  expect(me.status).toBe(200);
});

test("the hourly cron deletes expired OIDC logins", async () => {
  const t = newBackend();
  await startLogin(t, "client=web");
  expect(await t.run((ctx) => ctx.db.query("oidcLogins").collect())).toHaveLength(1);

  await advance(t, 60 * 60_000, { only: ["delete expired OIDC logins"] });
  expect(await t.run((ctx) => ctx.db.query("oidcLogins").collect())).toHaveLength(0);
});

test("advancing without interval crons leaves expired OIDC logins for the cleanup job", async () => {
  const t = newBackend();
  await startLogin(t, "client=web");

  await advance(t, 60 * 60_000, { only: [] });

  expect(Date.now()).toBe(NOW + 60 * 60_000);
  expect(await t.run((ctx) => ctx.db.query("oidcLogins").collect())).toHaveLength(1);
});
