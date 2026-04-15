import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from "jose";

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

export class AppleIdentityVerificationError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "AppleIdentityVerificationError";
    this.statusCode = statusCode;
  }
}

export async function verifyAppleIdentityToken(identityToken: string): Promise<string> {
  if (!looksLikeJwt(identityToken)) {
    throw new AppleIdentityVerificationError("Invalid Apple identity token format", 401);
  }

  const audience = resolveAppleAudience();

  try {
    const { payload } = await jwtVerify(identityToken, APPLE_JWKS, {
      issuer: APPLE_ISSUER,
      audience,
    });

    if (typeof payload.sub !== "string" || payload.sub.trim() === "") {
      throw new AppleIdentityVerificationError(
        "Apple identity token did not include a valid sub",
        401,
      );
    }

    return payload.sub.trim();
  } catch (error) {
    if (error instanceof AppleIdentityVerificationError) {
      throw error;
    }

    if (
      error instanceof joseErrors.JWTExpired ||
      error instanceof joseErrors.JWTInvalid ||
      error instanceof joseErrors.JWTClaimValidationFailed ||
      error instanceof joseErrors.JWSSignatureVerificationFailed ||
      error instanceof joseErrors.JWSInvalid ||
      error instanceof joseErrors.JWKSNoMatchingKey ||
      error instanceof joseErrors.JWKSMultipleMatchingKeys
    ) {
      throw new AppleIdentityVerificationError("Apple identity token verification failed", 401);
    }

    if (
      error instanceof joseErrors.JWKSTimeout ||
      error instanceof joseErrors.JWKSInvalid ||
      error instanceof TypeError
    ) {
      throw new AppleIdentityVerificationError(
        "Apple identity token verification is temporarily unavailable",
        502,
      );
    }

    throw new AppleIdentityVerificationError("Apple identity token verification failed", 500);
  }
}

function resolveAppleAudience(): string {
  const explicitAudience = process.env.APPLE_AUTH_AUDIENCE?.trim();
  if (explicitAudience) {
    return explicitAudience;
  }

  const apnsTopic = process.env.APNS_TOPIC?.trim();
  if (apnsTopic) {
    return apnsTopic;
  }

  const associatedAppId = process.env.UNIVERSAL_LINKS_APP_ID?.trim();
  if (associatedAppId) {
    const [, ...rest] = associatedAppId.split(".");
    const derivedAudience = rest.join(".").trim();
    if (derivedAudience) {
      return derivedAudience;
    }
  }

  throw new AppleIdentityVerificationError("Apple identity verification is not configured", 500);
}

function looksLikeJwt(value: string): boolean {
  return value.split(".").length === 3;
}
