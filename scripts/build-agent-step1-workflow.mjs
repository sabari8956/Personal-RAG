import crypto from 'node:crypto';
import { writeFileSync } from 'node:fs';

const id = () => crypto.randomUUID();

const workflow = {
  name: 'rag_agent_chat_step1',
  nodes: [
    {
      parameters: {
        httpMethod: 'POST',
        path: 'rag-agent-chat',
        responseMode: 'responseNode',
        options: {},
      },
      id: id(),
      name: 'Webhook Chat',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [180, 320],
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
                '={{$json.body?.query || $json.query || $json.body?.message || $json.message || $json.chatInput || ""}}',
              type: 'string',
            },
            {
              id: id(),
              name: 'session_id',
              value: '={{$json.body?.session_id || $json.session_id || $json.chatId || $execution.id}}',
              type: 'string',
            },
          ],
        },
        options: {},
      },
      id: id(),
      name: 'Edit Input Fields',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [420, 320],
    },
    {
      parameters: {
        promptType: 'define',
        text: '={{ $json.query }}',
        options: {
          systemMessage:
            'You are a RAG assistant for personal and company conversations. Use Qdrant Vector Store tool to retrieve knowledge for factual questions. If retrieval does not provide enough data, say you do not have enough indexed information.',
        },
      },
      id: id(),
      name: 'AI Agent',
      type: '@n8n/n8n-nodes-langchain.agent',
      typeVersion: 3,
      position: [680, 320],
    },
    {
      parameters: {
        sessionIdType: 'customKey',
        sessionKey: '={{ $json.session_id }}',
      },
      id: id(),
      name: 'Simple Memory',
      type: '@n8n/n8n-nodes-langchain.memoryBufferWindow',
      typeVersion: 1.3,
      position: [700, 520],
    },
    {
      parameters: {
        mode: 'retrieve-as-tool',
        toolDescription:
          'Retrieve relevant chunks from personal/company indexed knowledge in Qdrant.',
        qdrantCollection: {
          __rl: true,
          mode: 'id',
          value: 'knowledge_base',
        },
        topK: 6,
        options: {},
      },
      id: id(),
      name: 'Qdrant Vector Store',
      type: '@n8n/n8n-nodes-langchain.vectorStoreQdrant',
      typeVersion: 1.3,
      position: [960, 520],
      credentials: {
        qdrantApi: {
          id: 'cyLgHqoAKSu8ibHB',
          name: 'Docker Qdrant',
        },
      },
    },
    {
      parameters: {
        model: 'nomic-embed-text:latest',
        options: {},
      },
      id: id(),
      name: 'Embeddings Ollama',
      type: '@n8n/n8n-nodes-langchain.embeddingsOllama',
      typeVersion: 1,
      position: [1180, 700],
      credentials: {
        ollamaApi: {
          id: '5MyXKFONAVc7e2Ug',
          name: 'Docker Ollama',
        },
      },
    },
    {
      parameters: {
        model: 'llama3.2:latest',
        options: {},
      },
      id: id(),
      name: 'Ollama Chat Model',
      type: '@n8n/n8n-nodes-langchain.lmChatOllama',
      typeVersion: 1,
      position: [500, 520],
      credentials: {
        ollamaApi: {
          id: '5MyXKFONAVc7e2Ug',
          name: 'Docker Ollama',
        },
      },
    },
    {
      parameters: {
        assignments: {
          assignments: [
            {
              id: id(),
              name: 'answer',
              value: '={{$json.output || $json.text || ""}}',
              type: 'string',
            },
            {
              id: id(),
              name: 'mode',
              value: 'grounded_plus_general',
              type: 'string',
            },
            {
              id: id(),
              name: 'confidence',
              value: '={{0.72}}',
              type: 'number',
            },
            {
              id: id(),
              name: 'session_id',
              value: '={{$("Edit Input Fields").item.json.session_id}}',
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
      name: 'Format Response',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [940, 320],
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
      name: 'Respond Chat',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.4,
      position: [1180, 320],
    },
  ],
  connections: {
    'Webhook Chat': {
      main: [[{ node: 'Edit Input Fields', type: 'main', index: 0 }]],
    },
    'Edit Input Fields': {
      main: [[{ node: 'AI Agent', type: 'main', index: 0 }]],
    },
    'AI Agent': {
      main: [[{ node: 'Format Response', type: 'main', index: 0 }]],
    },
    'Format Response': {
      main: [[{ node: 'Respond Chat', type: 'main', index: 0 }]],
    },
    'Simple Memory': {
      ai_memory: [[{ node: 'AI Agent', type: 'ai_memory', index: 0 }]],
    },
    'Qdrant Vector Store': {
      ai_tool: [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]],
    },
    'Embeddings Ollama': {
      ai_embedding: [[{ node: 'Qdrant Vector Store', type: 'ai_embedding', index: 0 }]],
    },
    'Ollama Chat Model': {
      ai_languageModel: [[{ node: 'AI Agent', type: 'ai_languageModel', index: 0 }]],
    },
  },
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

writeFileSync(
  '/Users/sabari/Work/sudo-sapient/R&D/rag-system-sabari/workflows/rag_agent_chat_step1.workflow.json',
  JSON.stringify(workflow, null, 2) + '\n',
  'utf8',
);

console.log('wrote workflows/rag_agent_chat_step1.workflow.json');
