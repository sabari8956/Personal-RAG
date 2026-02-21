import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { N8nProxyError, forwardJsonWebhook } from "@/lib/n8n-client";
import { logEvent } from "@/lib/log";
import { errorResponse } from "@/lib/route-response";
import { createTraceId } from "@/lib/trace";
import type { QueryWebhookRequest, QueryWebhookResponse } from "@/lib/types";
import { chatRequestSchema, chatResponseSchema } from "@/lib/validators";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const traceId = createTraceId();

  try {
    const env = getEnv();
    const payload = await request.json();
    const parsed = chatRequestSchema.safeParse(payload);

    if (!parsed.success) {
      return errorResponse(
        400,
        "INVALID_REQUEST",
        "Invalid chat payload",
        traceId,
        parsed.error.flatten(),
      );
    }

    const outboundPayload: QueryWebhookRequest = {
      trace_id: traceId,
      session_id: parsed.data.session_id,
      query: parsed.data.query,
      history: parsed.data.history,
      language_hint: parsed.data.language_hint,
    };

    const upstream = await forwardJsonWebhook<QueryWebhookResponse>({
      url: env.N8N_QUERY_WEBHOOK_URL,
      secret: env.N8N_WEBHOOK_SHARED_SECRET,
      traceId,
      payload: outboundPayload,
      metadata: {
        endpoint: "chat",
      },
    });

    const validated = chatResponseSchema.safeParse(upstream);
    if (!validated.success) {
      return errorResponse(
        502,
        "UPSTREAM_BAD_RESPONSE",
        "n8n returned an invalid response payload",
        traceId,
      );
    }

    logEvent({
      level: "info",
      event: "chat_request_succeeded",
      trace_id: traceId,
      details: {
        mode: validated.data.mode,
      },
    });

    return NextResponse.json(
      {
        answer: validated.data.answer,
        mode: validated.data.mode,
        confidence: validated.data.confidence,
        session_id: parsed.data.session_id,
        trace_id: validated.data.trace_id ?? traceId,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof N8nProxyError) {
      logEvent({
        level: "warn",
        event: "chat_request_failed",
        trace_id: traceId,
        details: {
          status: error.status,
          code: error.code,
        },
      });

      return errorResponse(
        error.status,
        error.code,
        error.message,
        traceId,
        error.details,
      );
    }

    logEvent({
      level: "error",
      event: "chat_request_crashed",
      trace_id: traceId,
      details: {
        error: error instanceof Error ? error.message : "Unknown error",
      },
    });

    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "Unexpected server error",
      traceId,
    );
  }
}
