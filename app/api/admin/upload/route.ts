import { NextResponse } from "next/server";

import { verifyAdminBasicAuth } from "@/lib/admin-auth";
import { getEnv } from "@/lib/env";
import { N8nProxyError, forwardBinaryWebhook } from "@/lib/n8n-client";
import { logEvent } from "@/lib/log";
import { errorResponse } from "@/lib/route-response";
import { createTraceId } from "@/lib/trace";
import type { IngestWebhookResponse, SourceType } from "@/lib/types";
import { ingestResponseSchema, sourceTypeSchema } from "@/lib/validators";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

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
            "WWW-Authenticate": 'Basic realm="Admin Upload"',
          },
        },
      );
    }

    const formData = await request.formData();
    const sourceTypeRaw = formData.get("source_type");
    const sourceTypeParsed = sourceTypeSchema.safeParse(
      typeof sourceTypeRaw === "string" ? sourceTypeRaw : "mixed",
    );

    if (!sourceTypeParsed.success) {
      return errorResponse(
        400,
        "INVALID_SOURCE_TYPE",
        "source_type must be one of: personal, company, mixed",
        traceId,
      );
    }

    const fileField = formData.get("file");
    if (!(fileField instanceof File)) {
      return errorResponse(
        400,
        "INVALID_FILE",
        "file is required and must be a PDF",
        traceId,
      );
    }

    if (fileField.size === 0) {
      return errorResponse(400, "EMPTY_FILE", "Uploaded file is empty", traceId);
    }

    if (fileField.size > MAX_FILE_BYTES) {
      return errorResponse(
        413,
        "FILE_TOO_LARGE",
        `PDF size exceeds ${MAX_FILE_BYTES / (1024 * 1024)}MB limit`,
        traceId,
      );
    }

    const isPdfByType = fileField.type === "application/pdf";
    const isPdfByName = fileField.name.toLowerCase().endsWith(".pdf");

    if (!isPdfByType && !isPdfByName) {
      return errorResponse(
        400,
        "INVALID_FILE_TYPE",
        "Only PDF files are supported",
        traceId,
      );
    }

    const binary = Buffer.from(await fileField.arrayBuffer());
    const sourceType: SourceType = sourceTypeParsed.data;

    const upstream = await forwardBinaryWebhook<IngestWebhookResponse>({
      url: env.N8N_INGEST_WEBHOOK_URL,
      secret: env.N8N_WEBHOOK_SHARED_SECRET,
      traceId,
      body: binary,
      contentType: "application/pdf",
      metadata: {
        endpoint: "ingest",
        source_type: sourceType,
        uploaded_by: auth.username ?? "admin",
        file_name: fileField.name,
        file_size: `${fileField.size}`,
      },
      timeoutMs: 120_000,
    });

    const validated = ingestResponseSchema.safeParse(upstream);
    if (!validated.success) {
      return errorResponse(
        502,
        "UPSTREAM_BAD_RESPONSE",
        "n8n returned an invalid ingest response",
        traceId,
      );
    }

    logEvent({
      level: "info",
      event: "admin_upload_succeeded",
      trace_id: traceId,
      details: {
        doc_id: validated.data.doc_id,
        source_type: sourceType,
      },
    });

    return NextResponse.json(
      {
        doc_id: validated.data.doc_id,
        status: validated.data.status,
        index_latency_ms: validated.data.index_latency_ms,
        trace_id: validated.data.trace_id ?? traceId,
      },
      { status: 200 },
    );
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
