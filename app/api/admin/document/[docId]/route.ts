import { NextResponse } from "next/server";

import { verifyAdminBasicAuth } from "@/lib/admin-auth";
import { getEnv } from "@/lib/env";
import { N8nProxyError, forwardJsonWebhook } from "@/lib/n8n-client";
import { errorResponse } from "@/lib/route-response";
import { createTraceId } from "@/lib/trace";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ docId: string }>;
};

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
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
            "WWW-Authenticate": 'Basic realm="Admin Delete"',
          },
        },
      );
    }

    const { docId } = await context.params;
    if (!docId || !docId.trim()) {
      return errorResponse(400, "INVALID_DOC_ID", "docId is required", traceId);
    }

    const upstream = await forwardJsonWebhook({
      url: env.N8N_ADMIN_WEBHOOK_URL,
      secret: env.N8N_WEBHOOK_SHARED_SECRET,
      traceId,
      payload: {
        action: "delete",
        doc_id: docId,
        trace_id: traceId,
      },
      metadata: {
        endpoint: "admin",
        action: "delete",
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
