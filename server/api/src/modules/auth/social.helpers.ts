import crypto from "node:crypto";
import { env } from "../../env";

type ProviderJsonWebKey = crypto.JsonWebKey;

type JsonWebKeySet = {
  keys: ProviderJsonWebKey[];
};

type IdTokenPayload = {
  aud: string;
  email?: string;
  email_verified?: boolean | string;
  exp: number;
  iss: string;
  name?: string;
  sub: string;
};

const jwksCache = new Map<string, { expiresAt: number; keys: ProviderJsonWebKey[] }>();

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url");
}

function parseJwt(idToken: string) {
  const [encodedHeader, encodedPayload, encodedSignature] = idToken.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) throw new Error("Invalid identity token");

  return {
    encodedHeader,
    encodedPayload,
    encodedSignature,
    header: JSON.parse(base64UrlDecode(encodedHeader).toString("utf8")) as { alg: string; kid: string },
    payload: JSON.parse(base64UrlDecode(encodedPayload).toString("utf8")) as IdTokenPayload
  };
}

async function getJwks(jwksUrl: string) {
  const cached = jwksCache.get(jwksUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.keys;

  const response = await fetch(jwksUrl);
  if (!response.ok) throw new Error("Could not load identity provider keys");

  const payload = (await response.json()) as JsonWebKeySet;
  jwksCache.set(jwksUrl, {
    expiresAt: Date.now() + 1000 * 60 * 60,
    keys: payload.keys
  });
  return payload.keys;
}

function derEncodeInteger(integer: Buffer) {
  let offset = 0;
  while (offset < integer.length - 1 && integer[offset] === 0) offset += 1;
  let value = integer.subarray(offset);
  if (value[0] & 0x80) value = Buffer.concat([Buffer.from([0]), value]);
  return Buffer.concat([Buffer.from([0x02, value.length]), value]);
}

function joseEcdsaToDer(signature: Buffer) {
  const length = signature.length / 2;
  const r = derEncodeInteger(signature.subarray(0, length));
  const s = derEncodeInteger(signature.subarray(length));
  const sequence = Buffer.concat([r, s]);
  return Buffer.concat([Buffer.from([0x30, sequence.length]), sequence]);
}

async function verifyJwtSignature(idToken: string, jwksUrl: string, expectedAlg: "RS256" | "ES256") {
  const { encodedHeader, encodedPayload, encodedSignature, header, payload } = parseJwt(idToken);
  if (header.alg !== expectedAlg) throw new Error("Unsupported identity token algorithm");

  const keys = await getJwks(jwksUrl);
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new Error("Identity token key was not found");

  const verifier = crypto.createVerify("SHA256");
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();

  const signature = base64UrlDecode(encodedSignature);
  const normalizedSignature = expectedAlg === "ES256" ? joseEcdsaToDer(signature) : signature;
  const publicKey = crypto.createPublicKey({ format: "jwk", key: jwk });
  const verified = verifier.verify(publicKey, normalizedSignature);
  if (!verified) throw new Error("Invalid identity token signature");

  return payload;
}

function assertCommonClaims(payload: IdTokenPayload, expectedAudience: string, allowedIssuers: string[]) {
  if (payload.aud !== expectedAudience) throw new Error("Identity token audience mismatch");
  if (!allowedIssuers.includes(payload.iss)) throw new Error("Identity token issuer mismatch");
  if (payload.exp * 1000 <= Date.now()) throw new Error("Identity token is expired");
  if (!payload.sub) throw new Error("Identity token subject is missing");
}

function isEmailVerified(value: boolean | string | undefined) {
  return value === true || value === "true";
}

export type VerifiedSocialIdentity = {
  email?: string;
  emailVerified: boolean;
  name?: string;
  providerUserId: string;
};

export async function verifyGoogleIdToken(idToken: string): Promise<VerifiedSocialIdentity> {
  const payload = await verifyJwtSignature(idToken, "https://www.googleapis.com/oauth2/v3/certs", "RS256");
  assertCommonClaims(payload, env.GOOGLE_CLIENT_ID, ["https://accounts.google.com", "accounts.google.com"]);

  return {
    email: payload.email,
    emailVerified: isEmailVerified(payload.email_verified),
    name: payload.name,
    providerUserId: payload.sub
  };
}

export async function verifyAppleIdToken(idToken: string): Promise<VerifiedSocialIdentity> {
  const payload = await verifyJwtSignature(idToken, "https://appleid.apple.com/auth/keys", "ES256");
  assertCommonClaims(payload, env.APPLE_CLIENT_ID, ["https://appleid.apple.com"]);

  return {
    email: payload.email,
    emailVerified: isEmailVerified(payload.email_verified),
    name: payload.name,
    providerUserId: payload.sub
  };
}
