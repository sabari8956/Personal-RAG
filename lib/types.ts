export type ChatRole = "user" | "assistant";

export type ChatHistoryEntry = {
  role: ChatRole;
  content: string;
};

export type SourceType = "personal" | "company" | "mixed";

export type QueryWebhookRequest = {
  trace_id: string;
  session_id: string;
  query: string;
  history: ChatHistoryEntry[];
  language_hint?: string;
};

export type QueryWebhookResponse = {
  answer: string;
  mode: "grounded" | "grounded_plus_general";
  confidence: number;
  trace_id?: string;
};

export type IngestWebhookResponse = {
  doc_id: string;
  status: string;
  index_latency_ms?: number;
  trace_id?: string;
};

export type AdminWebhookResponse = {
  status: string;
  trace_id?: string;
  [key: string]: unknown;
};
