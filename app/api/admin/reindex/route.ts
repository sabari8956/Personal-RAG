import { NextResponse } from "next/server";

import { verifyAdminBasicAuth } from "@/lib/admin-auth";
import { getEnv } from "@/lib/env";
import { N8nProxyError, forwardJsonWebhook } from "@/lib/n8n-client";
import { errorResponse } from "@/lib/route-response";
import { createTraceId } from "@/lib/trace";
import { reindexRequestSchema } from "@/lib/validators";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const traceId = createTraceId();

  try {
    const env = getEnv();
    const auth = verifyAdminBasicAuth(
      request.headers.get("authorization"),
      env.ADMIN_BASIC_USER,
      env.ADMIN_BASIC_PASS,
    );

    if (!auth.ok) {
      return NextResponse.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Missing or invalid admin credentials",
            trace_id: traceId,
          },
        },
        {
          status: 401,
          headers: {
            "WWW-Authenticate": 'Basic realm="Admin Reindex"',
          },
        },
      );
    }

    const payload = await request.json();
    const parsed = reindexRequestSchema.safeParse(payload);

    if (!parsed.success) {
      return errorResponse(
        400,
        "INVALID_REQUEST",
        "doc_id is required",
        traceId,
        parsed.error.flatten(),
      );
    }

    const upstream = await forwardJsonWebhook({
      url: env.N8N_ADMIN_WEBHOOK_URL,
      secret: env.N8N_WEBHOOK_SHARED_SECRET,
      traceId,
      payload: {
        action: "reindex",
        doc_id: parsed.data.doc_id,
        trace_id: traceId,
      },
      metadata: {
        endpoint: "admin",
        action: "reindex",
      },
      timeoutMs: 120_000,
    });

    return NextResponse.json(upstream, { status: 200 });
  } catch (error) {
    if (error instanceof N8nProxyError) {
      return errorResponse(
        error.status,
        error.code,
        error.message,
        traceId,
        error.details,
      );
    }

    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "Unexpected server error",
      traceId,
    );
  }
}
