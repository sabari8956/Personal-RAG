"use client";

import { FormEvent, useMemo, useState } from "react";

type SourceType = "personal" | "company" | "mixed";

function buildAuthHeader(username: string, password: string): string {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

export function AdminPanel() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("mixed");
  const [file, setFile] = useState<File | null>(null);
  const [docId, setDocId] = useState("");
  const [loading, setLoading] = useState(false);
  const [responseText, setResponseText] = useState<string>("No action yet.");

  const hasCredentials = useMemo(() => {
    return username.trim().length > 0 && password.length > 0;
  }, [password, username]);

  function withPrettyJson(data: unknown) {
    setResponseText(JSON.stringify(data, null, 2));
  }

  async function uploadPdf(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !hasCredentials || loading) {
      return;
    }

    setLoading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("source_type", sourceType);

      const response = await fetch("/api/admin/upload", {
        method: "POST",
        headers: {
          Authorization: buildAuthHeader(username, password),
        },
        body: form,
      });

      const data = (await response.json()) as unknown;
      withPrettyJson(data);
      if (response.ok) {
        setFile(null);
        const fileInput = document.getElementById("pdf-file") as HTMLInputElement | null;
        if (fileInput) {
          fileInput.value = "";
        }
      }
    } catch (error) {
      withPrettyJson({
        error: error instanceof Error ? error.message : "Unexpected request error",
      });
    } finally {
      setLoading(false);
    }
  }

  async function reindexDoc() {
    if (!docId.trim() || !hasCredentials || loading) {
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/admin/reindex", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: buildAuthHeader(username, password),
        },
        body: JSON.stringify({ doc_id: docId.trim() }),
      });
      withPrettyJson(await response.json());
    } catch (error) {
      withPrettyJson({
        error: error instanceof Error ? error.message : "Unexpected request error",
      });
    } finally {
      setLoading(false);
    }
  }

  async function deleteDoc() {
    if (!docId.trim() || !hasCredentials || loading) {
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/admin/document/${encodeURIComponent(docId.trim())}`, {
        method: "DELETE",
        headers: {
          Authorization: buildAuthHeader(username, password),
        },
      });
      withPrettyJson(await response.json());
    } catch (error) {
      withPrettyJson({
        error: error instanceof Error ? error.message : "Unexpected request error",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel admin-panel">
      <div className="panel-header">
        <div>
          <h2>Admin Controls</h2>
          <p>PDF ingestion and maintenance calls are forwarded to secure n8n webhooks.</p>
        </div>
      </div>

      <div className="admin-grid">
        <label>
          Admin Username
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="admin user"
          />
        </label>
        <label>
          Admin Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="********"
          />
        </label>
      </div>

      <form className="upload-form" onSubmit={uploadPdf}>
        <label>
          Source Type
          <select
            value={sourceType}
            onChange={(event) => setSourceType(event.target.value as SourceType)}
          >
            <option value="mixed">mixed</option>
            <option value="personal">personal</option>
            <option value="company">company</option>
          </select>
        </label>

        <label>
          PDF File
          <input
            id="pdf-file"
            type="file"
            accept="application/pdf"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
            }}
          />
        </label>

        <button type="submit" disabled={!file || !hasCredentials || loading}>
          {loading ? "Processing..." : "Upload PDF"}
        </button>
      </form>

      <div className="doc-actions">
        <label>
          Document ID
          <input
            value={docId}
            onChange={(event) => setDocId(event.target.value)}
            placeholder="doc_123"
          />
        </label>
        <div className="btn-row">
          <button type="button" onClick={reindexDoc} disabled={!hasCredentials || !docId || loading}>
            Reindex
          </button>
          <button type="button" onClick={deleteDoc} disabled={!hasCredentials || !docId || loading}>
            Delete
          </button>
        </div>
      </div>

      <label className="response-view">
        API Response
        <textarea readOnly value={responseText} rows={12} />
      </label>
    </section>
  );
}
