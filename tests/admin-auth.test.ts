import { describe, expect, it } from "vitest";

import { verifyAdminBasicAuth } from "@/lib/admin-auth";

describe("verifyAdminBasicAuth", () => {
  it("accepts valid credentials", () => {
    const token = Buffer.from("admin:strong-password", "utf8").toString("base64");
    const result = verifyAdminBasicAuth(
      `Basic ${token}`,
      "admin",
      "strong-password",
    );

    expect(result.ok).toBe(true);
    expect(result.username).toBe("admin");
  });

  it("rejects wrong credentials", () => {
    const token = Buffer.from("admin:wrong-password", "utf8").toString("base64");
    const result = verifyAdminBasicAuth(
      `Basic ${token}`,
      "admin",
      "strong-password",
    );

    expect(result.ok).toBe(false);
  });

  it("rejects malformed headers", () => {
    const result = verifyAdminBasicAuth("Bearer abc", "admin", "strong-password");
    expect(result.ok).toBe(false);
  });
});
