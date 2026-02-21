import { z } from "zod";

export const sourceTypeSchema = z.enum(["personal", "company", "mixed"]);

export const chatHistoryEntrySchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4000),
});

export const chatRequestSchema = z.object({
  session_id: z.string().trim().min(8).max(128),
  query: z.string().trim().min(1).max(2000),
  history: z.array(chatHistoryEntrySchema).max(20).default([]),
  language_hint: z.string().trim().min(2).max(32).optional(),
});

export const chatResponseSchema = z.object({
  answer: z.string().trim().min(1),
  mode: z.enum(["grounded", "grounded_plus_general"]),
  confidence: z.number().min(0).max(1),
  trace_id: z.string().optional(),
});

export const ingestResponseSchema = z.object({
  doc_id: z.string().trim().min(1),
  status: z.string().trim().min(1),
  index_latency_ms: z.number().int().nonnegative().optional(),
  trace_id: z.string().optional(),
});

export const reindexRequestSchema = z.object({
  doc_id: z.string().trim().min(1).max(256),
});
