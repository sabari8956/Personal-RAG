import { NextResponse } from "next/server";

export function errorResponse(
  status: number,
  code: string,
  message: string,
  traceId: string,
  details?: unknown,
): NextResponse {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        trace_id: traceId,
        details,
      },
    },
    { status },
  );
}
