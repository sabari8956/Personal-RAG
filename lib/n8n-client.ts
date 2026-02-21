import { buildSignedHeaders } from "@/lib/signature";

export class N8nProxyError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

type SignedRequestBase = {
  url: string;
  secret: string;
  traceId: string;
  timeoutMs?: number;
  metadata?: Record<string, string>;
};

type ForwardJsonParams = SignedRequestBase & {
  payload: unknown;
};

type ForwardBinaryParams = SignedRequestBase & {
  body: Buffer;
  contentType: string;
};

async function parseResponsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

function sanitizeMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "string") {
    return payload.slice(0, 280) || fallback;
  }
  if (payload && typeof payload === "object") {
    const maybeError = (payload as { error?: unknown }).error;
    if (typeof maybeError === "string") {
      return maybeError.slice(0, 280);
    }
    if (maybeError && typeof maybeError === "object") {
      const maybeMessage = (maybeError as { message?: unknown }).message;
      if (typeof maybeMessage === "string") {
        return maybeMessage.slice(0, 280);
      }
    }

    const maybeMessage = (payload as { message?: unknown }).message;
    if (typeof maybeMessage === "string") {
      return maybeMessage.slice(0, 280);
    }
  }
  return fallback;
}

async function signedFetch<T>(params: {
  method: "POST" | "DELETE";
  url: string;
  secret: string;
  traceId: string;
  body: Buffer;
  contentType: string;
  timeoutMs?: number;
  metadata?: Record<string, string>;
}): Promise<T> {
  const timeoutMs = params.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const signed = buildSignedHeaders({
    method: params.method,
    url: params.url,
    body: params.body,
    secret: params.secret,
    traceId: params.traceId,
    metadata: params.metadata,
  });

  const headers: Record<string, string> = {
    "Content-Type": params.contentType,
    ...signed.headers,
  };

  if (params.metadata) {
    for (const [key, value] of Object.entries(params.metadata)) {
      const normalizedKey = key.replace(/[^a-zA-Z0-9-]/g, "-");
      headers[`X-RAG-Meta-${normalizedKey}`] = value;
    }
  }

  try {
    const response = await fetch(params.url, {
      method: params.method,
      headers,
      body: new Uint8Array(params.body),
      cache: "no-store",
      signal: controller.signal,
    });

    const payload = await parseResponsePayload(response);

    if (!response.ok) {
      const fallback = `n8n webhook returned HTTP ${response.status}`;
      throw new N8nProxyError(
        response.status >= 500 ? "UPSTREAM_ERROR" : "UPSTREAM_REJECTED",
        response.status,
        sanitizeMessage(payload, fallback),
        payload,
      );
    }

    return payload as T;
  } catch (error) {
    if (error instanceof N8nProxyError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new N8nProxyError(
        "UPSTREAM_TIMEOUT",
        504,
        "n8n webhook request timed out",
      );
    }

    throw new N8nProxyError(
      "UPSTREAM_UNAVAILABLE",
      503,
      "n8n webhook is unavailable",
      error,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function forwardJsonWebhook<T = Record<string, unknown>>(
  params: ForwardJsonParams,
): Promise<T> {
  return signedFetch<T>({
    method: "POST",
    url: params.url,
    secret: params.secret,
    traceId: params.traceId,
    timeoutMs: params.timeoutMs,
    metadata: params.metadata,
    body: Buffer.from(JSON.stringify(params.payload), "utf8"),
    contentType: "application/json",
  });
}

export async function forwardBinaryWebhook<T = Record<string, unknown>>(
  params: ForwardBinaryParams,
): Promise<T> {
  return signedFetch<T>({
    method: "POST",
    url: params.url,
    secret: params.secret,
    traceId: params.traceId,
    timeoutMs: params.timeoutMs,
    metadata: params.metadata,
    body: params.body,
    contentType: params.contentType,
  });
}
