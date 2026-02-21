# n8n Webhook Contracts

This app forwards all RAG requests to existing n8n workflows.

## Webhooks

- Query: `N8N_QUERY_WEBHOOK_URL`
- Ingest: `N8N_INGEST_WEBHOOK_URL`
- Admin maintenance: `N8N_ADMIN_WEBHOOK_URL`

## Common Security Headers

Each proxied request includes:

- `X-RAG-Signature-Version: v1`
- `X-RAG-Timestamp`
- `X-RAG-Nonce`
- `X-RAG-Trace-Id`
- `X-RAG-Method`
- `X-RAG-Path`
- `X-RAG-Body-Sha256`
- `X-RAG-Meta-Sha256`
- `X-RAG-Signature: v1=<hex-hmac>`

Metadata headers are prefixed with `X-RAG-Meta-`.

## Signature Canonical String (v1)

```text
v1
<timestamp>
<nonce>
<HTTP_METHOD>
<url_path_with_query>
<body_sha256_hex>
<metadata_sha256_hex>
```

- HMAC algorithm: `sha256`
- Key: `N8N_WEBHOOK_SHARED_SECRET`

## Payload Contracts

### Query webhook request body (JSON)

```json
{
  "trace_id": "uuid",
  "session_id": "session-id",
  "query": "user question",
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "language_hint": "optional"
}
```

### Query webhook response body (JSON)

```json
{
  "answer": "assistant response",
  "mode": "grounded",
  "confidence": 0.89,
  "trace_id": "uuid"
}
```

### Ingest webhook request

- Content-Type: `application/pdf`
- Body: PDF binary
- Required metadata headers:
  - `X-RAG-Meta-source_type`: `personal|company|mixed`
  - `X-RAG-Meta-uploaded_by`
  - `X-RAG-Meta-file_name`
  - `X-RAG-Meta-file_size`

### Ingest webhook response body (JSON)

```json
{
  "doc_id": "doc_123",
  "status": "indexed",
  "index_latency_ms": 1400,
  "trace_id": "uuid"
}
```

### Admin maintenance webhook request body (JSON)

Reindex:

```json
{
  "action": "reindex",
  "doc_id": "doc_123",
  "trace_id": "uuid"
}
```

Delete:

```json
{
  "action": "delete",
  "doc_id": "doc_123",
  "trace_id": "uuid"
}
```

## Example n8n Code Node Signature Verification

Use this in an early Code node in each webhook workflow.

```javascript
const crypto = require('crypto');

const headers = $json.headers || {};
const signatureHeader = headers['x-rag-signature'] || '';
const timestamp = headers['x-rag-timestamp'] || '';
const nonce = headers['x-rag-nonce'] || '';
const version = headers['x-rag-signature-version'] || '';
const method = (headers['x-rag-method'] || 'POST').toUpperCase();
const path = headers['x-rag-path'] || '';
const bodySha = headers['x-rag-body-sha256'] || '';
const metaSha = headers['x-rag-meta-sha256'] || '';

if (version !== 'v1' || !signatureHeader.startsWith('v1=')) {
  throw new Error('Invalid signature version');
}

const canonical = ['v1', timestamp, nonce, method, path, bodySha, metaSha].join('\n');
const expected = crypto
  .createHmac('sha256', $env.N8N_WEBHOOK_SHARED_SECRET)
  .update(canonical)
  .digest('hex');

const actual = signatureHeader.slice(3);
if (actual !== expected) {
  throw new Error('Invalid HMAC signature');
}

return [{ json: { verified: true } }];
```

Adapt header/path extraction based on your webhook node output structure.
