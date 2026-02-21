# n8n Workflow Blueprints

These workflow blueprints match the web gateway contracts in this repo.

Import-ready versions are available in `/workflows/*.workflow.json`.

## 1) `rag_query_webhook`

Trigger:
- Webhook node (`POST`) at your query webhook path.

Flow:
1. Verify signature (Code node).
2. Validate fields: `trace_id`, `session_id`, `query`, optional `history`, optional `language_hint`.
3. Create query embedding via Ollama node/HTTP Request node.
4. Search Qdrant `knowledge_base` with `top_k=6`.
5. Build grounded prompt (Code node / Set node).
6. Generate answer via Ollama.
7. Compute `mode` (`grounded` or `grounded_plus_general`) from retrieval score threshold.
8. Log hidden provenance (`trace_id`, doc/page/score).
9. Respond JSON:
   - `answer`
   - `mode`
   - `confidence`
   - `trace_id`

## 2) `rag_ingest_webhook`

Trigger:
- Webhook node (`POST`) ingest endpoint.
- Expect binary payload (`application/pdf`).

Flow:
1. Verify signature (Code node).
2. Validate metadata headers:
   - `source_type`
   - `uploaded_by`
   - `file_name`
   - `file_size`
3. Extract text from PDF (reject textless/scanned docs in v1).
4. Chunk text (target ~800 chars, overlap ~120).
5. Embed chunks via Ollama embedding model.
6. Upsert vectors into Qdrant `knowledge_base` with payload metadata:
   - `doc_id`, `file_name`, `source_type`, `chunk_index`, `page_start`, `page_end`, `content_hash`, `ingested_at`
7. Respond JSON:
   - `doc_id`
   - `status`
   - `index_latency_ms`
   - `trace_id`

## 3) `rag_admin_maintenance_webhook`

Trigger:
- Webhook node (`POST`) admin endpoint.

Payload:
- Reindex: `{ "action": "reindex", "doc_id": "...", "trace_id": "..." }`
- Delete: `{ "action": "delete", "doc_id": "...", "trace_id": "..." }`

Flow:
1. Verify signature.
2. Branch on `action`.
3. Reindex branch: re-run ingest pipeline by `doc_id`.
4. Delete branch: delete all vector points by `doc_id`.
5. Respond JSON with `status` and `trace_id`.

## 4) `rag_healthcheck_cron`

Trigger:
- Cron every 5 minutes.

Flow:
1. Check Ollama endpoint/model availability.
2. Check Qdrant health and `knowledge_base` collection.
3. Optional synthetic query path check.
4. Log and alert failures.

## Response Rules

- Always include `trace_id` in success and error responses.
- Keep user-facing response citation-free.
- Preserve provenance in internal logs.
