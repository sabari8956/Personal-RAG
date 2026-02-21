# RAG Web Gateway (n8n + Qdrant + Ollama)

A Dockerized Next.js web app that exposes:

- Public chat endpoint/UI (`/` + `POST /api/chat`)
- Admin ingestion and maintenance UI (`/admin`)
- Signed webhook proxy calls to your existing n8n workflows

This repo does **not** run n8n/Qdrant/Ollama. It assumes they already exist and are reachable from n8n.

## Features

- Open public chat API/UI
- Basic-auth protected admin APIs
- HMAC-signed outbound webhook calls to n8n
- PDF upload forwarding (binary + metadata)
- Reindex/delete forwarding APIs
- Session-only memory in browser
- Trace IDs on every request

## Required Environment Variables

Copy `.env.example` to `.env.local` and set values:

```bash
cp .env.example .env.local
```

- `N8N_QUERY_WEBHOOK_URL`
- `N8N_INGEST_WEBHOOK_URL`
- `N8N_ADMIN_WEBHOOK_URL`
- `N8N_WEBHOOK_SHARED_SECRET`
- `ADMIN_BASIC_USER`
- `ADMIN_BASIC_PASS`
- `SESSION_SECRET`
- `LOG_RETENTION_DAYS`

## Local Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Docker Run

```bash
docker build -t rag-web-gateway .
docker run --rm -p 3000:3000 --env-file .env.local rag-web-gateway
```

## API Contracts

### `POST /api/chat`
Request:

```json
{
  "session_id": "uuid-or-stable-id",
  "query": "What do you do?",
  "history": [{ "role": "user", "content": "..." }],
  "language_hint": "en"
}
```

Response:

```json
{
  "answer": "...",
  "mode": "grounded",
  "confidence": 0.91,
  "session_id": "...",
  "trace_id": "..."
}
```

### `POST /api/admin/upload`
- Basic Auth required
- Multipart form data:
  - `file`: PDF
  - `source_type`: `personal | company | mixed`

### `POST /api/admin/reindex`
- Basic Auth required
- JSON body: `{ "doc_id": "..." }`

### `DELETE /api/admin/document/:docId`
- Basic Auth required

## n8n Signature Contract

See `/docs/n8n-webhook-contracts.md` for canonical string format, required headers, and a starter verification code snippet for n8n Code nodes.
See `/docs/n8n-workflow-blueprints.md` for the four workflow blueprints (`query`, `ingest`, `maintenance`, `healthcheck`).
Import-ready workflow files are in `/workflows`.

## n8n Workflow Artifacts

Generated files:

- `/workflows/rag_agent_chat_step1.workflow.json` (step 1: chat -> AI Agent)
- `/workflows/rag_query_webhook.workflow.json`
- `/workflows/rag_ingest_webhook.workflow.json`
- `/workflows/rag_admin_maintenance_webhook.workflow.json`
- `/workflows/rag_healthcheck_cron.workflow.json`

Live n8n workflow created for step 1:

- `oXYLYWtSYPlMcEcQ` (`rag_agent_chat_step1`)
- Webhook path: `/webhook/rag-agent-chat`

Step 2 will add Qdrant retrieval and admin ingestion workflows on top of this stable chat-agent baseline.

Regenerate artifacts after editing template script:

```bash
node scripts/build-workflow-artifacts.mjs
```

Dry-run deployment to existing n8n:

```bash
N8N_API_URL=https://your-n8n \
N8N_API_KEY=your_key \
./scripts/deploy-workflows.sh
```

Apply deployment:

```bash
N8N_API_URL=https://your-n8n \
N8N_API_KEY=your_key \
./scripts/deploy-workflows.sh --apply
```

## Required n8n Runtime Env Vars

These must be configured on the n8n instance running the workflows:

- `N8N_WEBHOOK_SHARED_SECRET`
- `QDRANT_URL`
- `QDRANT_API_KEY` (optional if Qdrant has no auth)
- `QDRANT_COLLECTION` (default: `knowledge_base`)
- `OLLAMA_BASE_URL` (default: `http://127.0.0.1:11434`)
- `RAG_EMBED_MODEL` (default: `nomic-embed-text`)
- `RAG_GEN_MODEL` (default: `qwen2.5:7b-instruct`)
- `RAG_TOP_K` (default: `6`)
- `RAG_RETRIEVAL_SCORE_THRESHOLD` (default: `0.72`)

## Scripts

- `npm run dev`
- `npm run lint`
- `npm run test`
- `npm run build`

## Notes

- Upload route enforces PDF-only and 20MB max file size.
- Error responses include a `trace_id` for debugging across app + n8n logs.
