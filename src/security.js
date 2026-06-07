import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual, createHash } from "node:crypto";

export function hashPassword(password, salt = randomBytes(16)) {
  const iterations = 120000;
  const digest = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  return `pbkdf2_sha256$${iterations}$${salt.toString("base64url")}$${digest.toString("base64url")}`;
}

export function verifyPassword(password, passwordHash) {
  const [scheme, iterationsText, saltText, digestText] = String(passwordHash || "").split("$");
  if (scheme !== "pbkdf2_sha256" || !iterationsText || !saltText || !digestText) {
    return false;
  }

  const expected = Buffer.from(digestText, "base64url");
  const actual = pbkdf2Sync(password || "", Buffer.from(saltText, "base64url"), Number(iterationsText), expected.length, "sha256");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function makeToken(prefix) {
  return `${prefix}_${randomUUID()}_${randomBytes(18).toString("base64url")}`;
}

export function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

