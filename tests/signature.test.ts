import { describe, expect, it } from "vitest";

import { buildCanonicalString, buildSignedHeaders } from "@/lib/signature";

describe("buildCanonicalString", () => {
  it("builds a deterministic canonical payload", () => {
    const canonical = buildCanonicalString({
      timestamp: "1700000000000",
      nonce: "nonce-1",
      method: "POST",
      path: "/webhook/rag-query",
      bodyHash: "abc123",
      metadataHash: "def456",
    });

    expect(canonical).toBe(
      [
        "v1",
        "1700000000000",
        "nonce-1",
        "POST",
        "/webhook/rag-query",
        "abc123",
        "def456",
      ].join("\n"),
    );
  });
});

describe("buildSignedHeaders", () => {
  it("creates the expected signature envelope", () => {
    const result = buildSignedHeaders({
      method: "POST",
      url: "https://n8n.example.com/webhook/rag-query",
      body: Buffer.from('{"hello":"world"}', "utf8"),
      secret: "0123456789abcdef0123456789abcdef",
      traceId: "trace-123",
      timestamp: "1700000000000",
      nonce: "nonce-1",
      metadata: {
        endpoint: "chat",
      },
    });

    expect(result.headers["X-RAG-Signature-Version"]).toBe("v1");
    expect(result.headers["X-RAG-Timestamp"]).toBe("1700000000000");
    expect(result.headers["X-RAG-Nonce"]).toBe("nonce-1");
    expect(result.headers["X-RAG-Trace-Id"]).toBe("trace-123");
    expect(result.headers["X-RAG-Method"]).toBe("POST");
    expect(result.headers["X-RAG-Path"]).toBe("/webhook/rag-query");
    expect(result.headers["X-RAG-Signature"]).toMatch(/^v1=[a-f0-9]{64}$/);
    expect(result.canonical).toContain("/webhook/rag-query");
  });
});
