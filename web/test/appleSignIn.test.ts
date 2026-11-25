import { authProvidersResponseSchema } from "@maudecode/cowtail-protocol";
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { newBackend, stubEnv, type Backend } from "./convexHarness";

// Sign in with Apple on the web (COW-53): Apple's authorization redirect with
// `response_mode=form_post`, and the callback that turns its ID token into a cookie session.

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const WEB_ORIGIN = "https://cowtail.test";
const SERVICES_ID = "com.example.cowtail.web";
const OWNER_USER_ID = "apple-owner-sub";
const CALLBACK = `${WEB_ORIGIN}/actions/api/auth/apple/callback`;

const signingKey = await generateKeyPair("RS256");
const publicJwk = { ...(await exportJWK(signingKey.publicKey)), kid: "apple-key", alg: "RS256" };

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  stubEnv({
    APPLE_WEB_SERVICES_ID: SERVICES_ID,
    COWTAIL_OWNER_USER_ID: OWNER_USER_ID,
    COWTAIL_WEB_ORIGIN: WEB_ORIGIN,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      if (String(input) === "https://appleid.apple.com/auth/keys") {
        return Response.json({ keys: [publicJwk] });
      }
      throw new Error(`unexpected fetch ${String(input)}`);
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function start(t: Backend) {
  const response = await t.fetch("/api/auth/apple/start");
  expect(response.status).toBe(302);
  const authorize = new URL(response.headers.get("location") ?? "");
  const loginCookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
  return { response, authorize, loginCookie };
}

// What Apple posts back once the owner signs in: the request's state, and an ID token for the
// Services ID that carries the request's nonce.
async function appleReply(authorize: URL, claims: Partial<JWTPayload> = {}) {
  const idToken = await new SignJWT({
    iss: "https://appleid.apple.com",
    aud: SERVICES_ID,
    sub: OWNER_USER_ID,
    exp: Math.floor(NOW / 1000) + 600,
    nonce: authorize.searchParams.get("nonce") ?? undefined,
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "apple-key" })
    .setIssuedAt()
    .sign(signingKey.privateKey);
  return {
    state: authorize.searchParams.get("state") ?? "",
    code: "apple-code",
    id_token: idToken,
  };
}

async function callback(t: Backend, form: Record<string, string>, cookie: string) {
  return await t.fetch("/api/auth/apple/callback", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    body: new URLSearchParams(form).toString(),
  });
}

async function sessionCount(t: Backend) {
  return (await t.run((ctx) => ctx.db.query("authSessions").collect())).length;
}

function sessionCookieSet(response: Response) {
  return (response.headers.get("set-cookie") ?? "").includes("cowtail_session=");
}

test("the start route sends the browser to Apple with a form-post reply bound to a login cookie", async () => {
  const t = newBackend();
  const { response, authorize, loginCookie } = await start(t);

  expect(`${authorize.origin}${authorize.pathname}`).toBe(
    "https://appleid.apple.com/auth/authorize",
  );
  expect(Object.fromEntries(authorize.searchParams)).toMatchObject({
    response_type: "code id_token",
    response_mode: "form_post",
    client_id: SERVICES_ID,
    redirect_uri: CALLBACK,
  });
  expect(authorize.searchParams.has("scope")).toBe(false);
  const state = authorize.searchParams.get("state") ?? "";
  const nonce = authorize.searchParams.get("nonce") ?? "";
  expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(loginCookie).toBe(`cowtail_apple_login=${state}.${nonce}`);
  expect((response.headers.get("set-cookie") ?? "").split("; ")).toEqual(
    expect.arrayContaining(["Max-Age=600", "Path=/", "HttpOnly", "Secure", "SameSite=None"]),
  );
});

test("the owner's Apple sign-in sets an owner session cookie and redirects home", async () => {
  const t = newBackend();
  const { authorize, loginCookie } = await start(t);
  const response = await callback(t, await appleReply(authorize), loginCookie);

  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/");
  const cookies = response.headers.getSetCookie();
  expect(cookies).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^cowtail_apple_login=; Max-Age=0;/),
      expect.stringMatching(/^cowtail_session=[0-9a-f]{64};.*HttpOnly; Secure; SameSite=Lax$/),
    ]),
  );
  const sessions = await t.run((ctx) => ctx.db.query("authSessions").collect());
  expect(sessions.map((session) => session.userId)).toEqual([OWNER_USER_ID]);

  const session = cookies.find((cookie) => cookie.startsWith("cowtail_session="))!.split(";")[0];
  const me = await t.fetch("/api/me/notification-preferences", { headers: { cookie: session } });
  expect(me.status).toBe(200);
});

test.each([
  { name: "a state other than the cookie's", form: { state: "forged-state" }, cookie: true },
  { name: "no login cookie", form: {}, cookie: false },
])("a callback with $name is refused with no session", async ({ form, cookie }) => {
  const t = newBackend();
  const { authorize, loginCookie } = await start(t);
  const response = await callback(
    t,
    { ...(await appleReply(authorize)), ...form },
    cookie ? loginCookie : "",
  );

  expect(response.status).toBe(400);
  expect(sessionCookieSet(response)).toBe(false);
  expect(await sessionCount(t)).toBe(0);
});

test.each([
  { name: "the app's audience instead of the Services ID", claims: { aud: "com.example.cowtail" } },
  { name: "a wrong nonce", claims: { nonce: "not-the-login-nonce" } },
  { name: "no nonce", claims: { nonce: undefined } },
  { name: "an expired token", claims: { exp: Math.floor(NOW / 1000) - 60 } },
  { name: "another issuer", claims: { iss: "https://other.test" } },
])("an ID token with $name is refused with no session", async ({ claims }) => {
  const t = newBackend();
  const { authorize, loginCookie } = await start(t);
  const response = await callback(t, await appleReply(authorize, claims), loginCookie);

  expect(response.status).toBe(401);
  expect(sessionCookieSet(response)).toBe(false);
  expect(await sessionCount(t)).toBe(0);
});

test("an Apple account other than the owner's gets 403 and no session", async () => {
  const t = newBackend();
  const { authorize, loginCookie } = await start(t);
  const response = await callback(
    t,
    await appleReply(authorize, { sub: "someone-else" }),
    loginCookie,
  );

  expect(response.status).toBe(403);
  expect(sessionCookieSet(response)).toBe(false);
  expect(await sessionCount(t)).toBe(0);
});

test("with the Services ID unset, providers report web Apple off and its routes are not found", async () => {
  const t = newBackend();
  vi.stubEnv("APPLE_WEB_SERVICES_ID", "");

  const providers = await t.fetch("/api/auth/providers");
  expect(authProvidersResponseSchema.parse(await providers.json())).toEqual({
    apple: true,
    appleWeb: false,
  });
  expect((await t.fetch("/api/auth/apple/start")).status).toBe(404);
  expect((await callback(t, { state: "s", id_token: "a.b.c" }, "")).status).toBe(404);
});

test("with the Services ID set, providers offer Apple on the web", async () => {
  const t = newBackend();

  const providers = await t.fetch("/api/auth/providers");
  expect(authProvidersResponseSchema.parse(await providers.json())).toEqual({
    apple: true,
    appleWeb: true,
  });
});
