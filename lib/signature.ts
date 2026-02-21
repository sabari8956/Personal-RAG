import { createHash, createHmac, randomUUID } from "node:crypto";

export type SignedHeadersInput = {
  method: string;
  url: string;
  body: Buffer;
  secret: string;
  traceId: string;
  metadata?: Record<string, string>;
  timestamp?: string;
  nonce?: string;
};

export type SignedHeaders = {
  headers: Record<string, string>;
  canonical: string;
};

function sha256Hex(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}

function canonicalMetadata(metadata: Record<string, string>): string {
  return JSON.stringify(
    Object.keys(metadata)
      .sort()
      .map((key) => [key, metadata[key]]),
  );
}

function urlPathWithSearch(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

export function buildCanonicalString(params: {
  timestamp: string;
  nonce: string;
  method: string;
  path: string;
  bodyHash: string;
  metadataHash: string;
}): string {
  return [
    "v1",
    params.timestamp,
    params.nonce,
    params.method.toUpperCase(),
    params.path,
    params.bodyHash,
    params.metadataHash,
  ].join("\n");
}

export function buildSignedHeaders(input: SignedHeadersInput): SignedHeaders {
  const timestamp = input.timestamp ?? Date.now().toString();
  const nonce = input.nonce ?? randomUUID();
  const method = input.method.toUpperCase();
  const path = urlPathWithSearch(input.url);
  const bodyHash = sha256Hex(input.body);
  const metadataHash = sha256Hex(canonicalMetadata(input.metadata ?? {}));
  const canonical = buildCanonicalString({
    timestamp,
    nonce,
    method,
    path,
    bodyHash,
    metadataHash,
  });
  const signature = createHmac("sha256", input.secret)
    .update(canonical)
    .digest("hex");

  return {
    headers: {
      "X-RAG-Signature-Version": "v1",
      "X-RAG-Timestamp": timestamp,
      "X-RAG-Nonce": nonce,
      "X-RAG-Trace-Id": input.traceId,
      "X-RAG-Method": method,
      "X-RAG-Path": path,
      "X-RAG-Body-Sha256": bodyHash,
      "X-RAG-Meta-Sha256": metadataHash,
      "X-RAG-Signature": `v1=${signature}`,
    },
    canonical,
  };
}
