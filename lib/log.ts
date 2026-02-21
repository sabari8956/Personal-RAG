type LogLevel = "info" | "warn" | "error";

type LogEvent = {
  level: LogLevel;
  event: string;
  trace_id: string;
  details?: Record<string, unknown>;
};

export function logEvent(input: LogEvent): void {
  const line = {
    timestamp: new Date().toISOString(),
    ...input,
  };
  console.log(JSON.stringify(line));
}
