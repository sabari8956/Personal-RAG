#!/usr/bin/env bash
set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

MODE="dry-run"
if [[ "${1:-}" == "--apply" ]]; then
  MODE="apply"
fi

: "${N8N_API_URL:?N8N_API_URL is required}"
: "${N8N_API_KEY:?N8N_API_KEY is required}"

api() {
  local method="$1"
  local url="$2"
  local body_file="${3:-}"
  local out_file="${4:-/tmp/n8n_api_response.json}"
  local http_code

  if [[ -n "$body_file" ]]; then
    http_code="$(curl -sS -o "$out_file" -w '%{http_code}' -X "$method" \
      -H "X-N8N-API-KEY: $N8N_API_KEY" \
      -H "Content-Type: application/json" \
      --data-binary "@$body_file" \
      "$url")"
  else
    http_code="$(curl -sS -o "$out_file" -w '%{http_code}' -X "$method" \
      -H "X-N8N-API-KEY: $N8N_API_KEY" \
      "$url")"
  fi

  if [[ "$http_code" -lt 200 || "$http_code" -ge 300 ]]; then
    echo "API call failed: $method $url (HTTP $http_code)" >&2
    cat "$out_file" >&2
    return 1
  fi

  cat "$out_file"
}

echo "Mode: $MODE"

workflows_json="$(api GET "$N8N_API_URL/api/v1/workflows?limit=250" "" /tmp/n8n_workflows_index.json)"

deploy_one() {
  local file="$1"
  local name
  name="$(jq -r '.name' "$file")"

  if [[ -z "$name" || "$name" == "null" ]]; then
    echo "Skipping $file (no workflow name)"
    return
  fi

  local existing_id
  existing_id="$(jq -r --arg name "$name" '.data[] | select(.name==$name) | .id' <<<"$workflows_json" | head -n1)"
  local payload_file
  payload_file="$(mktemp)"
  jq '{name,nodes,connections,settings}' "$file" >"$payload_file"

  if [[ -z "$existing_id" ]]; then
    if [[ "$MODE" == "dry-run" ]]; then
      echo "[create] $name from $file"
      rm -f "$payload_file"
      return
    fi

    echo "[create] $name"
    api POST "$N8N_API_URL/api/v1/workflows" "$payload_file" /tmp/n8n_create_resp.json >/tmp/n8n_create_resp_stdout.json
    local created_id
    created_id="$(jq -r '.id // .data.id // empty' /tmp/n8n_create_resp.json)"
    echo "  created id: ${created_id:-unknown}"
    rm -f "$payload_file"
    return
  fi

  if [[ "$MODE" == "dry-run" ]]; then
    echo "[update] $name ($existing_id) from $file"
    rm -f "$payload_file"
    return
  fi

  echo "[update] $name ($existing_id)"
  api PATCH "$N8N_API_URL/api/v1/workflows/$existing_id" "$payload_file" /tmp/n8n_update_resp.json >/tmp/n8n_update_resp_stdout.json
  echo "  updated"
  rm -f "$payload_file"
}

for file in workflows/*.workflow.json; do
  deploy_one "$file"
done

echo "Done"
