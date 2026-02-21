import { timingSafeEqual } from "node:crypto";

type AdminAuthResult = {
  ok: boolean;
  username?: string;
};

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyAdminBasicAuth(
  authHeader: string | null,
  expectedUser: string,
  expectedPass: string,
): AdminAuthResult {
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return { ok: false };
  }

  const encoded = authHeader.slice("Basic ".length).trim();
  if (!encoded) {
    return { ok: false };
  }

  let decoded = "";
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return { ok: false };
  }

  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) {
    return { ok: false };
  }

  const username = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);

  const validUser = safeEqual(username, expectedUser);
  const validPass = safeEqual(password, expectedPass);

  if (!validUser || !validPass) {
    return { ok: false };
  }

  return { ok: true, username };
}
