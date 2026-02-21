import crypto from 'node:crypto';
import { writeFileSync } from 'node:fs';

const id = () => crypto.randomUUID();

function baseWorkflow(name, nodes, connections) {
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

const deterministicQuery = baseWorkflow(
  'rag_query_deterministic_v1',
  [
    {
      parameters: {
        httpMethod: 'POST',
        path: 'rag-agent-chat',
        responseMode: 'responseNode',
        options: {},
      },
      id: id(),
      name: 'Webhook Query',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [120, 280],
      webhookId: id(),
    },
    {
      parameters: {
        assignments: {
          assignments: [
            {
              id: id(),
              name: 'query',
              value:
                '={{$json.body?.query || $json.query || $json.body?.message || $json.message || ""}}',
              type: 'string',
            },
            {
              id: id(),
              name: 'session_id',
              value: '={{$json.body?.session_id || $json.session_id || $execution.id}}',
              type: 'string',
            },
            {
              id: id(),
              name: 'trace_id',
              value: '={{$execution.id}}',
              type: 'string',
            },
          ],
        },
        options: {},
      },
      id: id(),
      name: 'Normalize Input',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [340, 280],
    },
    {
      parameters: {
        method: 'POST',
        url: 'http://ollama:11434/api/embeddings',
        sendBody: true,
        specifyBody: 'json',
        jsonBody:
          '={{ JSON.stringify({ model: "nomic-embed-text:latest", prompt: $json.query }) }}',
        options: {
          timeout: 30000,
        },
      },
      id: id(),
      name: 'Embed Query',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.3,
      position: [560, 280],
    },
    {
      parameters: {
        assignments: {
          assignments: [
            {
              id: id(),
              name: 'query',
              value: '={{$("Normalize Input").item.json.query}}',
              type: 'string',
            },
            {
              id: id(),
              name: 'session_id',
              value: '={{$("Normalize Input").item.json.session_id}}',
              type: 'string',
            },
            {
              id: id(),
              name: 'trace_id',
              value: '={{$("Normalize Input").item.json.trace_id}}',
              type: 'string',
            },
            {
              id: id(),
              name: 'vector',
              value: '={{$json.embedding || ($json.data && $json.data[0] && $json.data[0].embedding) || []}}',
              type: 'array',
            },
          ],
        },
        options: {},
      },
      id: id(),
      name: 'Prepare Search Payload',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [790, 280],
    },
    {
      parameters: {
        method: 'POST',
        url: 'http://qdrant:6333/collections/knowledge_base/points/search',
        sendBody: true,
        specifyBody: 'json',
        jsonBody:
          '={{ JSON.stringify({ vector: $json.vector, limit: 6, with_payload: true, with_vector: false, score_threshold: 0.2 }) }}',
        options: {
          timeout: 30000,
        },
      },
      id: id(),
      name: 'Search Qdrant',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.3,
      position: [1020, 280],
    },
    {
      parameters: {
        jsCode: `const query = $('Prepare Search Payload').item.json.query;
const session_id = $('Prepare Search Payload').item.json.session_id;
const trace_id = $('Prepare Search Payload').item.json.trace_id;
const result = Array.isArray($json.result) ? $json.result : [];
const confidence = Number(result[0]?.score || 0);
const threshold = 0.72;
const mode = confidence >= threshold ? 'grounded' : 'grounded_plus_general';
const context = result
  .map((item, idx) => {
    const payload = item.payload || {};
    const text = payload.text || payload.chunk || payload.content || '';
    if (!text || typeof text !== 'string') return null;
    return '[' + (idx + 1) + '] ' + text.slice(0, 1600);
  })
  .filter(Boolean)
  .join('\\n\\n');

const prompt = [
  'You are a concise RAG assistant for personal and company information.',
  'Answer ONLY from retrieved context when possible.',
  'If context is insufficient, say you do not have enough indexed information.',
  '',
  'User query:',
  query,
  '',
  'Retrieved context:',
  context || '(no relevant context)',
].join('\\n');

return [{ json: { query, session_id, trace_id, prompt, confidence, mode } }];`,
      },
      id: id(),
      name: 'Build Prompt',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1240, 280],
    },
    {
      parameters: {
        method: 'POST',
        url: 'http://ollama:11434/api/generate',
        sendBody: true,
        specifyBody: 'json',
        jsonBody:
          '={{ JSON.stringify({ model: "qwen2.5:7b", prompt: $json.prompt, stream: false, options: { temperature: 0.2 } }) }}',
        options: {
          timeout: 120000,
        },
      },
      id: id(),
      name: 'Generate Answer',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.3,
      position: [1460, 280],
    },
    {
      parameters: {
        assignments: {
          assignments: [
            {
              id: id(),
              name: 'answer',
              value: '={{$json.response || $json.output || ""}}',
              type: 'string',
            },
            {
              id: id(),
              name: 'mode',
              value: '={{$("Build Prompt").item.json.mode}}',
              type: 'string',
            },
            {
              id: id(),
              name: 'confidence',
              value: '={{$("Build Prompt").item.json.confidence}}',
              type: 'number',
            },
            {
              id: id(),
              name: 'session_id',
              value: '={{$("Build Prompt").item.json.session_id}}',
              type: 'string',
            },
            {
              id: id(),
              name: 'trace_id',
              value: '={{$("Build Prompt").item.json.trace_id}}',
              type: 'string',
            },
          ],
        },
        options: {},
      },
      id: id(),
      name: 'Format Response',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [1690, 280],
    },
    {
      parameters: {
        respondWith: 'json',
        responseBody: '={{$json}}',
        options: {
          responseCode: 200,
        },
      },
      id: id(),
      name: 'Respond Query',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.4,
      position: [1910, 280],
    },
  ],
  {
    'Webhook Query': { main: [[{ node: 'Normalize Input', type: 'main', index: 0 }]] },
    'Normalize Input': { main: [[{ node: 'Embed Query', type: 'main', index: 0 }]] },
    'Embed Query': { main: [[{ node: 'Prepare Search Payload', type: 'main', index: 0 }]] },
    'Prepare Search Payload': { main: [[{ node: 'Search Qdrant', type: 'main', index: 0 }]] },
    'Search Qdrant': { main: [[{ node: 'Build Prompt', type: 'main', index: 0 }]] },
    'Build Prompt': { main: [[{ node: 'Generate Answer', type: 'main', index: 0 }]] },
    'Generate Answer': { main: [[{ node: 'Format Response', type: 'main', index: 0 }]] },
    'Format Response': { main: [[{ node: 'Respond Query', type: 'main', index: 0 }]] },
  },
);

const ingestWorkflow = baseWorkflow(
  'rag_admin_ingest_v1',
  [
    {
      parameters: {
        httpMethod: 'POST',
        path: 'rag-admin-upload',
        responseMode: 'responseNode',
        options: {},
      },
      id: id(),
      name: 'Webhook Upload',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [140, 340],
      webhookId: id(),
    },
    {
      parameters: {
        operation: 'pdf',
        binaryPropertyName: 'data',
        options: {
          joinPages: true,
        },
      },
      id: id(),
      name: 'Extract PDF Text',
      type: 'n8n-nodes-base.extractFromFile',
      typeVersion: 1,
      position: [380, 340],
    },
    {
      parameters: {
        assignments: {
          assignments: [
            {
              id: id(),
              name: 'text',
              value: '={{String($json.text || $json.extractedText || $json.data || "").trim()}}',
              type: 'string',
            },
            {
              id: id(),
              name: 'source_type',
              value:
                '={{($json.headers?.["x-rag-meta-source_type"] || $json.headers?.["x-rag-meta-source-type"] || "mixed").toString()}}',
              type: 'string',
            },
            {
              id: id(),
              name: 'file_name',
              value:
                '={{($json.headers?.["x-rag-meta-file_name"] || $json.headers?.["x-rag-meta-file-name"] || "upload.pdf").toString()}}',
              type: 'string',
            },
            {
              id: id(),
              name: 'doc_id',
              value: '={{"doc_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10)}}',
              type: 'string',
            },
            {
              id: id(),
              name: 'ingested_at',
              value: '={{$now.toISO()}}',
              type: 'string',
            },
          ],
        },
        options: {},
      },
      id: id(),
      name: 'Prepare Metadata',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [620, 340],
    },
    {
      parameters: {
        conditions: {
          options: {
            caseSensitive: true,
            leftValue: '',
            typeValidation: 'strict',
            version: 2,
          },
          conditions: [
            {
              id: id(),
              leftValue: '={{($json.text || "").length}}',
              rightValue: 80,
              operator: { type: 'number', operation: 'gte' },
            },
          ],
          combinator: 'and',
        },
        options: {},
      },
      id: id(),
      name: 'Has Usable Text?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [840, 340],
    },
    {
      parameters: {
        jsCode: `const text = String($json.text || '');
const chunkSize = 800;
const overlap = 120;
const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0;
  const v = c === 'x' ? r : (r & 0x3 | 0x8);
  return v.toString(16);
});
const chunks = [];
let start = 0;
let chunkIndex = 0;
while (start < text.length) {
  const end = Math.min(start + chunkSize, text.length);
  const chunk = text.slice(start, end).trim();
  if (chunk) {
    chunks.push({
      json: {
        doc_id: $json.doc_id,
        source_type: $json.source_type,
        file_name: $json.file_name,
        ingested_at: $json.ingested_at,
        chunk_index: chunkIndex,
        chunk_text: chunk,
        point_id: uuid(),
      },
    });
    chunkIndex += 1;
  }
  if (end >= text.length) break;
  start = Math.max(0, end - overlap);
}
return chunks;`,
      },
      id: id(),
      name: 'Chunk Text',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1060, 280],
    },
    {
      parameters: {
        method: 'POST',
        url: 'http://ollama:11434/api/embeddings',
        sendBody: true,
        specifyBody: 'json',
        jsonBody:
          '={{ JSON.stringify({ model: "nomic-embed-text:latest", prompt: $json.chunk_text }) }}',
        options: {
          timeout: 30000,
        },
      },
      id: id(),
      name: 'Embed Chunk',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.3,
      position: [1280, 280],
    },
    {
      parameters: {
        assignments: {
          assignments: [
            {
              id: id(),
              name: 'doc_id',
              value: '={{$("Chunk Text").item.json.doc_id}}',
              type: 'string',
            },
            {
              id: id(),
              name: 'source_type',
              value: '={{$("Chunk Text").item.json.source_type}}',
              type: 'string',
            },
            {
              id: id(),
              name: 'file_name',
              value: '={{$("Chunk Text").item.json.file_name}}',
              type: 'string',
            },
            {
              id: id(),
              name: 'ingested_at',
              value: '={{$("Chunk Text").item.json.ingested_at}}',
              type: 'string',
            },
            {
              id: id(),
              name: 'chunk_index',
              value: '={{$("Chunk Text").item.json.chunk_index}}',
              type: 'number',
            },
            {
              id: id(),
              name: 'chunk_text',
              value: '={{$("Chunk Text").item.json.chunk_text}}',
              type: 'string',
            },
            {
              id: id(),
              name: 'vector',
              value: '={{$json.embedding || ($json.data && $json.data[0] && $json.data[0].embedding) || []}}',
              type: 'array',
            },
            {
              id: id(),
              name: 'point_id',
              value: '={{$("Chunk Text").item.json.point_id}}',
              type: 'string',
            },
          ],
        },
        options: {},
      },
      id: id(),
      name: 'Build Qdrant Point',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [1500, 280],
    },
    {
      parameters: {
        method: 'PUT',
        url: 'http://qdrant:6333/collections/knowledge_base/points?wait=true',
        sendBody: true,
        specifyBody: 'json',
        jsonBody:
          '={{ JSON.stringify({ points: [{ id: $json.point_id, vector: $json.vector, payload: { pageContent: $json.chunk_text, metadata: { doc_id: $json.doc_id, source_type: $json.source_type, file_name: $json.file_name, chunk_index: $json.chunk_index, ingested_at: $json.ingested_at, text: $json.chunk_text }, doc_id: $json.doc_id, source_type: $json.source_type, file_name: $json.file_name, chunk_index: $json.chunk_index, text: $json.chunk_text, ingested_at: $json.ingested_at } }] }) }}',
        options: {
          timeout: 30000,
        },
      },
      id: id(),
      name: 'Upsert Qdrant Point',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.3,
      position: [1720, 280],
    },
    {
      parameters: {
        aggregate: 'aggregateAllItemData',
        options: {},
      },
      id: id(),
      name: 'Aggregate Upserts',
      type: 'n8n-nodes-base.aggregate',
      typeVersion: 1,
      position: [1940, 280],
    },
    {
      parameters: {
        assignments: {
          assignments: [
            { id: id(), name: 'doc_id', value: '={{$("Prepare Metadata").item.json.doc_id}}', type: 'string' },
            { id: id(), name: 'status', value: 'indexed', type: 'string' },
            { id: id(), name: 'source_type', value: '={{$("Prepare Metadata").item.json.source_type}}', type: 'string' },
            { id: id(), name: 'file_name', value: '={{$("Prepare Metadata").item.json.file_name}}', type: 'string' },
            { id: id(), name: 'chunks_indexed', value: '={{$items("Chunk Text").length}}', type: 'number' },
          ],
        },
        options: {},
      },
      id: id(),
      name: 'Build Upload Response',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [2160, 280],
    },
    {
      parameters: {
        assignments: {
          assignments: [
            { id: id(), name: 'error', value: 'UNPROCESSABLE_PDF_TEXT', type: 'string' },
            { id: id(), name: 'message', value: 'Unable to extract usable text from PDF', type: 'string' },
            { id: id(), name: 'status', value: 'rejected', type: 'string' },
          ],
        },
        options: {},
      },
      id: id(),
      name: 'Build Reject Response',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [1060, 460],
    },
    {
      parameters: {
        respondWith: 'json',
        responseBody: '={{$json}}',
        options: { responseCode: 200 },
      },
      id: id(),
      name: 'Respond Upload',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.4,
      position: [2380, 280],
    },
    {
      parameters: {
        respondWith: 'json',
        responseBody: '={{$json}}',
        options: { responseCode: 422 },
      },
      id: id(),
      name: 'Respond Upload Rejected',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.4,
      position: [1280, 460],
    },
  ],
  {
    'Webhook Upload': { main: [[{ node: 'Extract PDF Text', type: 'main', index: 0 }]] },
    'Extract PDF Text': { main: [[{ node: 'Prepare Metadata', type: 'main', index: 0 }]] },
    'Prepare Metadata': { main: [[{ node: 'Has Usable Text?', type: 'main', index: 0 }]] },
    'Has Usable Text?': {
      main: [
        [{ node: 'Chunk Text', type: 'main', index: 0 }],
        [{ node: 'Build Reject Response', type: 'main', index: 0 }],
      ],
    },
    'Chunk Text': { main: [[{ node: 'Embed Chunk', type: 'main', index: 0 }]] },
    'Embed Chunk': { main: [[{ node: 'Build Qdrant Point', type: 'main', index: 0 }]] },
    'Build Qdrant Point': { main: [[{ node: 'Upsert Qdrant Point', type: 'main', index: 0 }]] },
    'Upsert Qdrant Point': { main: [[{ node: 'Aggregate Upserts', type: 'main', index: 0 }]] },
    'Aggregate Upserts': { main: [[{ node: 'Build Upload Response', type: 'main', index: 0 }]] },
    'Build Upload Response': { main: [[{ node: 'Respond Upload', type: 'main', index: 0 }]] },
    'Build Reject Response': { main: [[{ node: 'Respond Upload Rejected', type: 'main', index: 0 }]] },
  },
);

const maintenanceWorkflow = baseWorkflow(
  'rag_admin_maintenance_v1',
  [
    {
      parameters: {
        httpMethod: 'POST',
        path: 'rag-admin-maintenance',
        responseMode: 'responseNode',
        options: {},
      },
      id: id(),
      name: 'Webhook Maintenance',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [180, 280],
      webhookId: id(),
    },
    {
      parameters: {
        jsCode: `const action = String($json.body?.action || '').trim().toLowerCase();
const docId = String($json.body?.doc_id || '').trim();
const allowed = ['delete', 'reindex', 'wipe_all'];
if (!allowed.includes(action)) {
  return [{ json: { statusCode: 400, body: { error: { code: 'INVALID_ACTION', message: 'action must be one of delete, reindex, wipe_all' } } } }];
}
if (action !== 'wipe_all' && !docId) {
  return [{ json: { statusCode: 400, body: { error: { code: 'INVALID_REQUEST', message: 'doc_id is required for delete/reindex' } } } }];
}
return [{ json: { action, doc_id: docId } }];`,
      },
      id: id(),
      name: 'Validate Maintenance Request',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [420, 280],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [
            {
              id: id(),
              leftValue: '={{$json.action}}',
              rightValue: 'delete',
              operator: { type: 'string', operation: 'equals' },
            },
          ],
          combinator: 'and',
        },
        options: {},
      },
      id: id(),
      name: 'Is Delete?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [640, 280],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [
            {
              id: id(),
              leftValue: '={{$json.action}}',
              rightValue: 'wipe_all',
              operator: { type: 'string', operation: 'equals' },
            },
          ],
          combinator: 'and',
        },
        options: {},
      },
      id: id(),
      name: 'Is Wipe All?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [860, 360],
    },
    {
      parameters: {
        method: 'POST',
        url: 'http://qdrant:6333/collections/knowledge_base/points/delete?wait=true',
        sendBody: true,
        specifyBody: 'json',
        jsonBody:
          '={{ JSON.stringify({ filter: { must: [{ key: "doc_id", match: { value: $json.doc_id } }] } }) }}',
        options: {},
      },
      id: id(),
      name: 'Delete From Qdrant',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.3,
      position: [880, 220],
    },
    {
      parameters: {
        assignments: {
          assignments: [
            { id: id(), name: 'status', value: 'deleted', type: 'string' },
            { id: id(), name: 'doc_id', value: '={{$("Validate Maintenance Request").item.json.doc_id}}', type: 'string' },
          ],
        },
        options: {},
      },
      id: id(),
      name: 'Build Delete Response',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [1110, 220],
    },
    {
      parameters: {
        method: 'POST',
        url: 'http://qdrant:6333/collections/knowledge_base/points/delete?wait=true',
        sendBody: true,
        specifyBody: 'json',
        jsonBody:
          '={{ JSON.stringify({ filter: { must: [] } }) }}',
        options: {},
      },
      id: id(),
      name: 'Wipe All From Qdrant',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.3,
      position: [1110, 360],
    },
    {
      parameters: {
        assignments: {
          assignments: [
            { id: id(), name: 'status', value: 'wiped_all', type: 'string' },
          ],
        },
        options: {},
      },
      id: id(),
      name: 'Build Wipe Response',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [1340, 360],
    },
    {
      parameters: {
        assignments: {
          assignments: [
            { id: id(), name: 'status', value: 'reindex_queued', type: 'string' },
            { id: id(), name: 'doc_id', value: '={{$("Validate Maintenance Request").item.json.doc_id}}', type: 'string' },
          ],
        },
        options: {},
      },
      id: id(),
      name: 'Build Reindex Response',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [880, 360],
    },
    {
      parameters: {
        respondWith: 'json',
        responseBody: '={{$json}}',
        options: { responseCode: 200 },
      },
      id: id(),
      name: 'Respond Maintenance',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.4,
      position: [1340, 280],
    },
  ],
  {
    'Webhook Maintenance': { main: [[{ node: 'Validate Maintenance Request', type: 'main', index: 0 }]] },
    'Validate Maintenance Request': { main: [[{ node: 'Is Delete?', type: 'main', index: 0 }]] },
    'Is Delete?': {
      main: [
        [{ node: 'Delete From Qdrant', type: 'main', index: 0 }],
        [{ node: 'Is Wipe All?', type: 'main', index: 0 }],
      ],
    },
    'Is Wipe All?': {
      main: [
        [{ node: 'Wipe All From Qdrant', type: 'main', index: 0 }],
        [{ node: 'Build Reindex Response', type: 'main', index: 0 }],
      ],
    },
    'Delete From Qdrant': { main: [[{ node: 'Build Delete Response', type: 'main', index: 0 }]] },
    'Wipe All From Qdrant': { main: [[{ node: 'Build Wipe Response', type: 'main', index: 0 }]] },
    'Build Delete Response': { main: [[{ node: 'Respond Maintenance', type: 'main', index: 0 }]] },
    'Build Wipe Response': { main: [[{ node: 'Respond Maintenance', type: 'main', index: 0 }]] },
    'Build Reindex Response': { main: [[{ node: 'Respond Maintenance', type: 'main', index: 0 }]] },
  },
);

const healthcheckWorkflow = baseWorkflow(
  'rag_healthcheck_v1',
  [
    {
      parameters: {
        rule: {
          interval: [{ field: 'minutes', minutesInterval: 5 }],
        },
      },
      id: id(),
      name: 'Every 5 Minutes',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.3,
      position: [180, 260],
    },
    {
      parameters: {
        method: 'GET',
        url: 'http://ollama:11434/api/tags',
        options: { timeout: 10000 },
      },
      id: id(),
      name: 'Check Ollama',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.3,
      position: [420, 220],
    },
    {
      parameters: {
        method: 'GET',
        url: 'http://qdrant:6333/collections',
        options: { timeout: 10000 },
      },
      id: id(),
      name: 'Check Qdrant',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.3,
      position: [420, 320],
    },
    {
      parameters: {
        jsCode: `return [{ json: { status: 'healthy', checked_at: new Date().toISOString() } }];`,
      },
      id: id(),
      name: 'Build Health Summary',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [660, 270],
    },
  ],
  {
    'Every 5 Minutes': {
      main: [[{ node: 'Check Ollama', type: 'main', index: 0 }, { node: 'Check Qdrant', type: 'main', index: 0 }]],
    },
    'Check Ollama': { main: [[{ node: 'Build Health Summary', type: 'main', index: 0 }]] },
    'Check Qdrant': { main: [[{ node: 'Build Health Summary', type: 'main', index: 0 }]] },
  },
);

writeFileSync('/Users/sabari/Work/sudo-sapient/R&D/rag-system-sabari/workflows/rag_query_deterministic_v1.workflow.json', JSON.stringify(deterministicQuery, null, 2) + '\n');
writeFileSync('/Users/sabari/Work/sudo-sapient/R&D/rag-system-sabari/workflows/rag_admin_ingest_v1.workflow.json', JSON.stringify(ingestWorkflow, null, 2) + '\n');
writeFileSync('/Users/sabari/Work/sudo-sapient/R&D/rag-system-sabari/workflows/rag_admin_maintenance_v1.workflow.json', JSON.stringify(maintenanceWorkflow, null, 2) + '\n');
writeFileSync('/Users/sabari/Work/sudo-sapient/R&D/rag-system-sabari/workflows/rag_healthcheck_v1.workflow.json', JSON.stringify(healthcheckWorkflow, null, 2) + '\n');

console.log('generated production workflows');
