import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';

const outDir = join(process.cwd(), 'workflows');
mkdirSync(outDir, { recursive: true });

function node(name, type, typeVersion, position, parameters, extra = {}) {
  return {
    parameters,
    type,
    typeVersion,
    position,
    id: crypto.randomUUID(),
    name,
    ...extra,
  };
}

function workflow(name, nodes, connections) {
  return {
    name,
    nodes,
    connections,
    settings: {
      executionOrder: 'v1',
      availableInMCP: false,
    },
    staticData: null,
    pinData: {},
    meta: {
      templateCredsSetupCompleted: true,
    },
    active: false,
  };
}

const queryCode = String.raw`const crypto = require('crypto');

function getHeader(headers, key) {
  if (!headers) return '';
  const value = headers[key] ?? headers[key.toLowerCase()] ?? headers[key.toUpperCase()];
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function normalizeHeaders(headers) {
  const out = {};
  Object.entries(headers || {}).forEach(([k, v]) => {
    out[String(k).toLowerCase()] = Array.isArray(v) ? String(v[0] || '') : String(v || '');
  });
  return out;
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const err = new Error('HTTP ' + response.status + ' from ' + url);
    err.statusCode = response.status;
    err.details = payload;
    throw err;
  }
  return payload;
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((entry) => entry && (entry.role === 'user' || entry.role === 'assistant') && typeof entry.content === 'string')
    .slice(-20)
    .map((entry) => ({ role: entry.role, content: entry.content.slice(0, 4000) }));
}

async function run() {
  const incoming = $input.first();
  const envelope = incoming.json || {};
  const headers = normalizeHeaders(envelope.headers || {});
  const body = envelope.body && typeof envelope.body === 'object' ? envelope.body : {};

  const traceId = getHeader(headers, 'x-rag-trace-id') || body.trace_id || crypto.randomUUID();

  try {
    const secret = process.env.N8N_WEBHOOK_SHARED_SECRET || '';
    if (!secret) {
      const err = new Error('N8N_WEBHOOK_SHARED_SECRET is not set');
      err.statusCode = 500;
      err.code = 'MISSING_SECRET';
      throw err;
    }

    const timestamp = getHeader(headers, 'x-rag-timestamp');
    const nonce = getHeader(headers, 'x-rag-nonce');
    const method = (getHeader(headers, 'x-rag-method') || envelope.method || 'POST').toUpperCase();
    const path = getHeader(headers, 'x-rag-path') || ('/' + String(envelope.path || '').replace(/^\/+/, ''));
    const bodySha = getHeader(headers, 'x-rag-body-sha256');
    const metaSha = getHeader(headers, 'x-rag-meta-sha256');
    const signature = getHeader(headers, 'x-rag-signature');

    if (!timestamp || !nonce || !bodySha || !metaSha || !signature) {
      const err = new Error('Missing signature headers');
      err.statusCode = 401;
      err.code = 'MISSING_SIGNATURE_HEADERS';
      throw err;
    }

    const skewMs = Math.abs(Date.now() - Number(timestamp));
    const maxSkewMs = Number(process.env.RAG_SIGNATURE_MAX_SKEW_MS || 300000);
    if (!Number.isFinite(skewMs) || skewMs > maxSkewMs) {
      const err = new Error('Signature timestamp outside allowed window');
      err.statusCode = 401;
      err.code = 'STALE_SIGNATURE';
      throw err;
    }

    const canonical = ['v1', timestamp, nonce, method, path, bodySha, metaSha].join('\n');
    const expected = 'v1=' + crypto.createHmac('sha256', secret).update(canonical).digest('hex');

    if (!timingSafeEqual(signature, expected)) {
      const err = new Error('Invalid webhook signature');
      err.statusCode = 401;
      err.code = 'INVALID_SIGNATURE';
      throw err;
    }

    const query = typeof body.query === 'string' ? body.query.trim() : '';
    const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : '';
    const history = sanitizeHistory(body.history);

    if (!query) {
      const err = new Error('query is required');
      err.statusCode = 400;
      err.code = 'INVALID_QUERY';
      throw err;
    }

    if (!sessionId) {
      const err = new Error('session_id is required');
      err.statusCode = 400;
      err.code = 'INVALID_SESSION';
      throw err;
    }

    const ollamaBase = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
    const qdrantBase = (process.env.QDRANT_URL || '').replace(/\/$/, '');
    if (!qdrantBase) {
      const err = new Error('QDRANT_URL is not configured');
      err.statusCode = 500;
      err.code = 'MISSING_QDRANT_URL';
      throw err;
    }

    const embedModel = process.env.RAG_EMBED_MODEL || 'nomic-embed-text';
    const genModel = process.env.RAG_GEN_MODEL || 'qwen2.5:7b-instruct';
    const topK = Number(process.env.RAG_TOP_K || 6);
    const threshold = Number(process.env.RAG_RETRIEVAL_SCORE_THRESHOLD || 0.72);
    const minSearchScore = Number(process.env.RAG_MIN_SEARCH_SCORE || 0.2);
    const qdrantCollection = process.env.QDRANT_COLLECTION || 'knowledge_base';

    const embeddingResponse = await requestJson(ollamaBase + '/api/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: embedModel, prompt: query }),
    });

    const vector = embeddingResponse.embedding
      || (Array.isArray(embeddingResponse.data) && embeddingResponse.data[0] && embeddingResponse.data[0].embedding)
      || null;

    if (!Array.isArray(vector) || vector.length === 0) {
      const err = new Error('Embedding model returned no vector');
      err.statusCode = 502;
      err.code = 'EMBEDDING_FAILED';
      throw err;
    }

    const qdrantHeaders = { 'Content-Type': 'application/json' };
    if (process.env.QDRANT_API_KEY) {
      qdrantHeaders['api-key'] = process.env.QDRANT_API_KEY;
    }

    const searchResponse = await requestJson(
      qdrantBase + '/collections/' + encodeURIComponent(qdrantCollection) + '/points/search',
      {
        method: 'POST',
        headers: qdrantHeaders,
        body: JSON.stringify({
          vector,
          limit: topK,
          with_payload: true,
          with_vector: false,
          score_threshold: minSearchScore,
        }),
      },
    );

    const matches = Array.isArray(searchResponse.result) ? searchResponse.result : [];
    const confidence = Number(matches[0]?.score || 0);

    const contextBlocks = matches
      .map((match, index) => {
        const payload = match.payload || {};
        const text = payload.text || payload.chunk || payload.content || '';
        if (!text || typeof text !== 'string') return null;
        return '[' + (index + 1) + '] ' + text.slice(0, 1600);
      })
      .filter(Boolean);

    const conversationText = history
      .map((entry) => entry.role.toUpperCase() + ': ' + entry.content)
      .join('\n');

    const prompt = [
      'You are an assistant for personal and company knowledge retrieval.',
      'Follow these rules:',
      '1. Prefer retrieved context first.',
      '2. If retrieval is weak, you may use concise general context but do not claim it came from documents.',
      '3. Do not output citations.',
      '',
      'Conversation history:',
      conversationText || '(empty)',
      '',
      'Retrieved context:',
      contextBlocks.length ? contextBlocks.join('\n\n') : '(no strong context)',
      '',
      'User question:',
      query,
      '',
      'Write a concise helpful answer.',
    ].join('\n');

    const generationResponse = await requestJson(ollamaBase + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: genModel,
        prompt,
        stream: false,
        options: {
          temperature: 0.2,
        },
      }),
    });

    const answer = String(
      generationResponse.response
      || generationResponse.message?.content
      || generationResponse.output
      || '',
    ).trim();

    if (!answer) {
      const err = new Error('Generation model returned empty answer');
      err.statusCode = 502;
      err.code = 'GENERATION_FAILED';
      throw err;
    }

    const mode = confidence >= threshold && contextBlocks.length > 0
      ? 'grounded'
      : 'grounded_plus_general';

    return [{
      json: {
        statusCode: 200,
        body: {
          answer,
          mode,
          confidence: Math.max(0, Math.min(1, confidence)),
          trace_id: traceId,
          retrieval_count: matches.length,
        },
      },
    }];
  } catch (error) {
    const statusCode = Number(error.statusCode || 500);
    const code = error.code || (statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED');

    return [{
      json: {
        statusCode,
        body: {
          error: {
            code,
            message: error.message || 'Unknown error',
            trace_id: traceId,
            details: error.details || undefined,
          },
        },
      },
    }];
  }
}

return run();`;

const ingestVerifyCode = String.raw`const crypto = require('crypto');

function getHeader(headers, key) {
  if (!headers) return '';
  const value = headers[key] ?? headers[key.toLowerCase()] ?? headers[key.toUpperCase()];
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function normalizeHeaders(headers) {
  const out = {};
  Object.entries(headers || {}).forEach(([k, v]) => {
    out[String(k).toLowerCase()] = Array.isArray(v) ? String(v[0] || '') : String(v || '');
  });
  return out;
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function fail(statusCode, code, message, traceId, details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  err.traceId = traceId;
  err.details = details;
  throw err;
}

async function run() {
  const incoming = $input.first();
  const envelope = incoming.json || {};
  const headers = normalizeHeaders(envelope.headers || {});
  const traceId = getHeader(headers, 'x-rag-trace-id') || crypto.randomUUID();

  try {
    const secret = process.env.N8N_WEBHOOK_SHARED_SECRET || '';
    if (!secret) {
      fail(500, 'MISSING_SECRET', 'N8N_WEBHOOK_SHARED_SECRET is not set', traceId);
    }

    const timestamp = getHeader(headers, 'x-rag-timestamp');
    const nonce = getHeader(headers, 'x-rag-nonce');
    const method = (getHeader(headers, 'x-rag-method') || envelope.method || 'POST').toUpperCase();
    const path = getHeader(headers, 'x-rag-path') || ('/' + String(envelope.path || '').replace(/^\/+/, ''));
    const bodySha = getHeader(headers, 'x-rag-body-sha256');
    const metaSha = getHeader(headers, 'x-rag-meta-sha256');
    const signature = getHeader(headers, 'x-rag-signature');

    if (!timestamp || !nonce || !bodySha || !metaSha || !signature) {
      fail(401, 'MISSING_SIGNATURE_HEADERS', 'Missing signature headers', traceId);
    }

    const skewMs = Math.abs(Date.now() - Number(timestamp));
    const maxSkewMs = Number(process.env.RAG_SIGNATURE_MAX_SKEW_MS || 300000);
    if (!Number.isFinite(skewMs) || skewMs > maxSkewMs) {
      fail(401, 'STALE_SIGNATURE', 'Signature timestamp outside allowed window', traceId);
    }

    const canonical = ['v1', timestamp, nonce, method, path, bodySha, metaSha].join('\n');
    const expected = 'v1=' + crypto.createHmac('sha256', secret).update(canonical).digest('hex');

    if (!timingSafeEqual(signature, expected)) {
      fail(401, 'INVALID_SIGNATURE', 'Invalid webhook signature', traceId);
    }

    const sourceType = getHeader(headers, 'x-rag-meta-source_type') || 'mixed';
    const uploadedBy = getHeader(headers, 'x-rag-meta-uploaded_by') || 'admin';
    const fileName = getHeader(headers, 'x-rag-meta-file_name') || 'upload.pdf';
    const fileSize = Number(getHeader(headers, 'x-rag-meta-file_size') || 0);

    if (!['personal', 'company', 'mixed'].includes(sourceType)) {
      fail(400, 'INVALID_SOURCE_TYPE', 'source_type must be personal, company, or mixed', traceId);
    }

    const binaryKeys = Object.keys(incoming.binary || {});
    if (binaryKeys.length === 0) {
      fail(400, 'MISSING_BINARY', 'Webhook did not receive PDF binary data', traceId);
    }

    const firstBinary = incoming.binary[binaryKeys[0]];

    return [{
      json: {
        trace_id: traceId,
        source_type: sourceType,
        uploaded_by: uploadedBy,
        file_name: fileName,
        file_size: fileSize,
        uploaded_at: new Date().toISOString(),
      },
      binary: {
        data: firstBinary,
      },
    }];
  } catch (error) {
    return [{
      json: {
        statusCode: Number(error.statusCode || 500),
        body: {
          error: {
            code: error.code || 'INGEST_REQUEST_FAILED',
            message: error.message || 'Unexpected ingest request error',
            trace_id: error.traceId || traceId,
            details: error.details || undefined,
          },
        },
      },
    }];
  }
}

return run();`;

const ingestProcessCode = String.raw`const crypto = require('crypto');

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const err = new Error('HTTP ' + response.status + ' from ' + url);
    err.statusCode = response.status;
    err.details = payload;
    throw err;
  }
  return payload;
}

function chunkText(text, chunkSize, overlap) {
  const chunks = [];
  let start = 0;
  const normalized = text.replace(/\r/g, '');

  while (start < normalized.length) {
    const end = Math.min(start + chunkSize, normalized.length);
    const slice = normalized.slice(start, end).trim();
    if (slice.length > 0) chunks.push(slice);
    if (end >= normalized.length) break;
    start = end - overlap;
    if (start < 0) start = 0;
  }

  return chunks;
}

function extractText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (typeof payload.text === 'string') return payload.text;
  if (typeof payload.extractedText === 'string') return payload.extractedText;
  if (Array.isArray(payload.text)) return payload.text.join('\n');
  if (typeof payload.data === 'string') return payload.data;
  if (Array.isArray(payload.data)) return payload.data.join('\n');
  return '';
}

async function run() {
  const item = $input.first();
  const envelope = item.json || {};

  if (envelope.body && envelope.statusCode) {
    return [item];
  }

  const traceId = envelope.trace_id || crypto.randomUUID();

  try {
    const text = extractText(envelope);
    if (!text || text.trim().length < 80) {
      const err = new Error('Unable to extract enough text from PDF (text PDFs only in v1)');
      err.statusCode = 422;
      err.code = 'UNPROCESSABLE_PDF_TEXT';
      throw err;
    }

    const sourceType = envelope.source_type || 'mixed';
    const fileName = envelope.file_name || 'upload.pdf';
    const uploadedBy = envelope.uploaded_by || 'admin';
    const chunkSize = Number(process.env.RAG_CHUNK_SIZE || 800);
    const overlap = Number(process.env.RAG_CHUNK_OVERLAP || 120);
    const chunks = chunkText(text, chunkSize, overlap);

    if (chunks.length === 0) {
      const err = new Error('No chunks generated from PDF text');
      err.statusCode = 422;
      err.code = 'EMPTY_CHUNKS';
      throw err;
    }

    const docId = crypto.randomUUID();
    const ingestedAt = new Date().toISOString();
    const contentHash = crypto.createHash('sha256').update(text).digest('hex');

    const ollamaBase = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
    const qdrantBase = (process.env.QDRANT_URL || '').replace(/\/$/, '');
    if (!qdrantBase) {
      const err = new Error('QDRANT_URL is not configured');
      err.statusCode = 500;
      err.code = 'MISSING_QDRANT_URL';
      throw err;
    }

    const embedModel = process.env.RAG_EMBED_MODEL || 'nomic-embed-text';
    const qdrantCollection = process.env.QDRANT_COLLECTION || 'knowledge_base';

    const vectors = [];
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      const embeddingResponse = await requestJson(ollamaBase + '/api/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: embedModel, prompt: chunk }),
      });

      const vector = embeddingResponse.embedding
        || (Array.isArray(embeddingResponse.data) && embeddingResponse.data[0] && embeddingResponse.data[0].embedding)
        || null;

      if (!Array.isArray(vector) || vector.length === 0) {
        const err = new Error('Embedding failed for chunk ' + i);
        err.statusCode = 502;
        err.code = 'EMBEDDING_FAILED';
        throw err;
      }

      vectors.push({
        id: crypto.randomUUID(),
        vector,
        payload: {
          doc_id: docId,
          file_name: fileName,
          source_type: sourceType,
          chunk_index: i,
          page_start: null,
          page_end: null,
          ingested_at: ingestedAt,
          uploaded_by: uploadedBy,
          content_hash: contentHash,
          text: chunk,
        },
      });
    }

    const qdrantHeaders = { 'Content-Type': 'application/json' };
    if (process.env.QDRANT_API_KEY) {
      qdrantHeaders['api-key'] = process.env.QDRANT_API_KEY;
    }

    const batchSize = Number(process.env.RAG_UPSERT_BATCH_SIZE || 32);
    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize);
      await requestJson(
        qdrantBase + '/collections/' + encodeURIComponent(qdrantCollection) + '/points?wait=true',
        {
          method: 'PUT',
          headers: qdrantHeaders,
          body: JSON.stringify({ points: batch }),
        },
      );
    }

    const elapsedMs = Date.now() - new Date(ingestedAt).getTime();

    return [{
      json: {
        statusCode: 200,
        body: {
          doc_id: docId,
          status: 'indexed',
          index_latency_ms: elapsedMs,
          trace_id: traceId,
          chunks_indexed: vectors.length,
        },
      },
    }];
  } catch (error) {
    return [{
      json: {
        statusCode: Number(error.statusCode || 500),
        body: {
          error: {
            code: error.code || 'INGEST_FAILED',
            message: error.message || 'Unexpected ingest processing error',
            trace_id: traceId,
            details: error.details || undefined,
          },
        },
      },
    }];
  }
}

return run();`;

const adminCode = String.raw`const crypto = require('crypto');

function getHeader(headers, key) {
  if (!headers) return '';
  const value = headers[key] ?? headers[key.toLowerCase()] ?? headers[key.toUpperCase()];
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function normalizeHeaders(headers) {
  const out = {};
  Object.entries(headers || {}).forEach(([k, v]) => {
    out[String(k).toLowerCase()] = Array.isArray(v) ? String(v[0] || '') : String(v || '');
  });
  return out;
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const err = new Error('HTTP ' + response.status + ' from ' + url);
    err.statusCode = response.status;
    err.details = payload;
    throw err;
  }
  return payload;
}

async function run() {
  const incoming = $input.first();
  const envelope = incoming.json || {};
  const headers = normalizeHeaders(envelope.headers || {});
  const body = envelope.body && typeof envelope.body === 'object' ? envelope.body : {};
  const traceId = getHeader(headers, 'x-rag-trace-id') || body.trace_id || crypto.randomUUID();

  try {
    const secret = process.env.N8N_WEBHOOK_SHARED_SECRET || '';
    if (!secret) {
      const err = new Error('N8N_WEBHOOK_SHARED_SECRET is not set');
      err.statusCode = 500;
      err.code = 'MISSING_SECRET';
      throw err;
    }

    const timestamp = getHeader(headers, 'x-rag-timestamp');
    const nonce = getHeader(headers, 'x-rag-nonce');
    const method = (getHeader(headers, 'x-rag-method') || envelope.method || 'POST').toUpperCase();
    const path = getHeader(headers, 'x-rag-path') || ('/' + String(envelope.path || '').replace(/^\/+/, ''));
    const bodySha = getHeader(headers, 'x-rag-body-sha256');
    const metaSha = getHeader(headers, 'x-rag-meta-sha256');
    const signature = getHeader(headers, 'x-rag-signature');

    if (!timestamp || !nonce || !bodySha || !metaSha || !signature) {
      const err = new Error('Missing signature headers');
      err.statusCode = 401;
      err.code = 'MISSING_SIGNATURE_HEADERS';
      throw err;
    }

    const canonical = ['v1', timestamp, nonce, method, path, bodySha, metaSha].join('\n');
    const expected = 'v1=' + crypto.createHmac('sha256', secret).update(canonical).digest('hex');

    if (!timingSafeEqual(signature, expected)) {
      const err = new Error('Invalid webhook signature');
      err.statusCode = 401;
      err.code = 'INVALID_SIGNATURE';
      throw err;
    }

    const action = typeof body.action === 'string' ? body.action.trim().toLowerCase() : '';
    const docId = typeof body.doc_id === 'string' ? body.doc_id.trim() : '';
    if (!action || !docId) {
      const err = new Error('action and doc_id are required');
      err.statusCode = 400;
      err.code = 'INVALID_REQUEST';
      throw err;
    }

    const qdrantBase = (process.env.QDRANT_URL || '').replace(/\/$/, '');
    if (!qdrantBase) {
      const err = new Error('QDRANT_URL is not configured');
      err.statusCode = 500;
      err.code = 'MISSING_QDRANT_URL';
      throw err;
    }

    const qdrantCollection = process.env.QDRANT_COLLECTION || 'knowledge_base';
    const qdrantHeaders = { 'Content-Type': 'application/json' };
    if (process.env.QDRANT_API_KEY) {
      qdrantHeaders['api-key'] = process.env.QDRANT_API_KEY;
    }

    if (action === 'delete') {
      await requestJson(
        qdrantBase + '/collections/' + encodeURIComponent(qdrantCollection) + '/points/delete?wait=true',
        {
          method: 'POST',
          headers: qdrantHeaders,
          body: JSON.stringify({
            filter: {
              must: [{ key: 'doc_id', match: { value: docId } }],
            },
          }),
        },
      );

      return [{
        json: {
          statusCode: 200,
          body: {
            status: 'deleted',
            doc_id: docId,
            trace_id: traceId,
          },
        },
      }];
    }

    if (action === 'reindex') {
      const points = [];
      let offset = null;

      do {
        const scrollBody = {
          filter: {
            must: [{ key: 'doc_id', match: { value: docId } }],
          },
          limit: 256,
          with_payload: true,
          with_vector: false,
        };
        if (offset !== null) {
          scrollBody.offset = offset;
        }

        const scrollResponse = await requestJson(
          qdrantBase + '/collections/' + encodeURIComponent(qdrantCollection) + '/points/scroll',
          {
            method: 'POST',
            headers: qdrantHeaders,
            body: JSON.stringify(scrollBody),
          },
        );

        const batch = Array.isArray(scrollResponse.result?.points)
          ? scrollResponse.result.points
          : [];
        points.push(...batch);
        offset = scrollResponse.result?.next_page_offset ?? null;
      } while (offset !== null);

      if (points.length === 0) {
        return [{
          json: {
            statusCode: 404,
            body: {
              error: {
                code: 'DOC_NOT_FOUND',
                message: 'No vectors found for doc_id',
                trace_id: traceId,
              },
            },
          },
        }];
      }

      const ollamaBase = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
      const embedModel = process.env.RAG_EMBED_MODEL || 'nomic-embed-text';
      const upsertPoints = [];

      for (const point of points) {
        const payload = point.payload || {};
        const text = payload.text || payload.chunk || payload.content || '';
        if (!text || typeof text !== 'string') {
          continue;
        }

        const embeddingResponse = await requestJson(ollamaBase + '/api/embeddings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: embedModel, prompt: text }),
        });

        const vector = embeddingResponse.embedding
          || (Array.isArray(embeddingResponse.data) && embeddingResponse.data[0] && embeddingResponse.data[0].embedding)
          || null;

        if (!Array.isArray(vector) || vector.length === 0) {
          continue;
        }

        upsertPoints.push({
          id: point.id,
          vector,
          payload: {
            ...payload,
            ingested_at: new Date().toISOString(),
          },
        });
      }

      if (upsertPoints.length > 0) {
        await requestJson(
          qdrantBase + '/collections/' + encodeURIComponent(qdrantCollection) + '/points?wait=true',
          {
            method: 'PUT',
            headers: qdrantHeaders,
            body: JSON.stringify({ points: upsertPoints }),
          },
        );
      }

      return [{
        json: {
          statusCode: 200,
          body: {
            status: 'reindexed',
            doc_id: docId,
            points_updated: upsertPoints.length,
            trace_id: traceId,
          },
        },
      }];
    }

    const err = new Error('Unsupported action: ' + action);
    err.statusCode = 400;
    err.code = 'UNSUPPORTED_ACTION';
    throw err;
  } catch (error) {
    return [{
      json: {
        statusCode: Number(error.statusCode || 500),
        body: {
          error: {
            code: error.code || 'ADMIN_ACTION_FAILED',
            message: error.message || 'Unexpected admin error',
            trace_id: traceId,
            details: error.details || undefined,
          },
        },
      },
    }];
  }
}

return run();`;

const healthcheckCode = String.raw`async function requestHealth(url, init) {
  const started = Date.now();
  try {
    const response = await fetch(url, init);
    return {
      ok: response.ok,
      status: response.status,
      latency_ms: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latency_ms: Date.now() - started,
      error: error.message || 'request failed',
    };
  }
}

async function run() {
  const qdrantBase = (process.env.QDRANT_URL || '').replace(/\/$/, '');
  const ollamaBase = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const qdrantCollection = process.env.QDRANT_COLLECTION || 'knowledge_base';

  const qdrantHeaders = {};
  if (process.env.QDRANT_API_KEY) {
    qdrantHeaders['api-key'] = process.env.QDRANT_API_KEY;
  }

  const ollama = await requestHealth(ollamaBase + '/api/tags');
  const qdrant = qdrantBase
    ? await requestHealth(qdrantBase + '/collections/' + encodeURIComponent(qdrantCollection), {
        headers: qdrantHeaders,
      })
    : { ok: false, status: 0, latency_ms: 0, error: 'QDRANT_URL not configured' };

  const overall = ollama.ok && qdrant.ok ? 'healthy' : 'degraded';

  return [{
    json: {
      status: overall,
      checked_at: new Date().toISOString(),
      ollama,
      qdrant,
    },
  }];
}

return run();`;

const ragQueryWorkflow = workflow(
  'rag_query_webhook',
  [
    node('Webhook Query', 'n8n-nodes-base.webhook', 2, [220, 300], {
      httpMethod: 'POST',
      path: 'rag-query',
      responseMode: 'responseNode',
      options: {
        rawBody: true,
      },
    }),
    node('Process Query', 'n8n-nodes-base.code', 2, [520, 300], {
      jsCode: queryCode,
    }),
    node('Respond Query', 'n8n-nodes-base.respondToWebhook', 1.4, [820, 300], {
      respondWith: 'json',
      responseBody: '={{$json.body}}',
      options: {
        responseCode: '={{$json.statusCode || 200}}',
      },
    }),
  ],
  {
    'Webhook Query': {
      main: [[{ node: 'Process Query', type: 'main', index: 0 }]],
    },
    'Process Query': {
      main: [[{ node: 'Respond Query', type: 'main', index: 0 }]],
    },
  },
);

const ragIngestWorkflow = workflow(
  'rag_ingest_webhook',
  [
    node('Webhook Ingest', 'n8n-nodes-base.webhook', 2, [220, 320], {
      httpMethod: 'POST',
      path: 'rag-ingest',
      responseMode: 'responseNode',
      options: {
        rawBody: true,
      },
    }),
    node('Verify Ingest Request', 'n8n-nodes-base.code', 2, [500, 320], {
      jsCode: ingestVerifyCode,
    }),
    node('Request Valid?', 'n8n-nodes-base.if', 2.2, [700, 320], {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'strict',
          version: 2,
        },
        conditions: [
          {
            id: crypto.randomUUID(),
            leftValue: '={{ $json.statusCode }}',
            rightValue: '',
            operator: {
              type: 'string',
              operation: 'exists',
              singleValue: true,
            },
          },
        ],
        combinator: 'and',
      },
      options: {},
    }),
    node('Extract PDF Text', 'n8n-nodes-base.extractFromFile', 1, [760, 320], {
      operation: 'pdf',
      options: {
        joinPages: true,
      },
    }),
    node('Chunk Embed Upsert', 'n8n-nodes-base.code', 2, [1040, 320], {
      jsCode: ingestProcessCode,
    }),
    node('Respond Ingest', 'n8n-nodes-base.respondToWebhook', 1.4, [1320, 320], {
      respondWith: 'json',
      responseBody: '={{$json.body}}',
      options: {
        responseCode: '={{$json.statusCode || 200}}',
      },
    }),
  ],
  {
    'Webhook Ingest': {
      main: [[{ node: 'Verify Ingest Request', type: 'main', index: 0 }]],
    },
    'Verify Ingest Request': {
      main: [[{ node: 'Request Valid?', type: 'main', index: 0 }]],
    },
    'Request Valid?': {
      main: [
        [{ node: 'Respond Ingest', type: 'main', index: 0 }],
        [{ node: 'Extract PDF Text', type: 'main', index: 0 }],
      ],
    },
    'Extract PDF Text': {
      main: [[{ node: 'Chunk Embed Upsert', type: 'main', index: 0 }]],
    },
    'Chunk Embed Upsert': {
      main: [[{ node: 'Respond Ingest', type: 'main', index: 0 }]],
    },
  },
);

const ragAdminWorkflow = workflow(
  'rag_admin_maintenance_webhook',
  [
    node('Webhook Admin', 'n8n-nodes-base.webhook', 2, [240, 320], {
      httpMethod: 'POST',
      path: 'rag-admin',
      responseMode: 'responseNode',
      options: {
        rawBody: true,
      },
    }),
    node('Process Admin Action', 'n8n-nodes-base.code', 2, [560, 320], {
      jsCode: adminCode,
    }),
    node('Respond Admin', 'n8n-nodes-base.respondToWebhook', 1.4, [860, 320], {
      respondWith: 'json',
      responseBody: '={{$json.body}}',
      options: {
        responseCode: '={{$json.statusCode || 200}}',
      },
    }),
  ],
  {
    'Webhook Admin': {
      main: [[{ node: 'Process Admin Action', type: 'main', index: 0 }]],
    },
    'Process Admin Action': {
      main: [[{ node: 'Respond Admin', type: 'main', index: 0 }]],
    },
  },
);

const ragHealthcheckWorkflow = workflow(
  'rag_healthcheck_cron',
  [
    node('Every 5 Minutes', 'n8n-nodes-base.scheduleTrigger', 1.3, [220, 280], {
      rule: {
        interval: [
          {
            field: 'minutes',
            minutesInterval: 5,
          },
        ],
      },
    }),
    node('Run Healthcheck', 'n8n-nodes-base.code', 2, [520, 280], {
      jsCode: healthcheckCode,
    }),
  ],
  {
    'Every 5 Minutes': {
      main: [[{ node: 'Run Healthcheck', type: 'main', index: 0 }]],
    },
  },
);

const workflows = [
  ['rag_query_webhook.workflow.json', ragQueryWorkflow],
  ['rag_ingest_webhook.workflow.json', ragIngestWorkflow],
  ['rag_admin_maintenance_webhook.workflow.json', ragAdminWorkflow],
  ['rag_healthcheck_cron.workflow.json', ragHealthcheckWorkflow],
];

for (const [filename, data] of workflows) {
  writeFileSync(join(outDir, filename), JSON.stringify(data, null, 2) + '\n', 'utf8');
}

console.log('Generated workflow artifacts in', outDir);
for (const [filename] of workflows) {
  console.log('-', filename);
}
