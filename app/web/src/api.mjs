export class ApiError extends Error {
  constructor(message, status, code, details) {
    super(message);
    Object.assign(this, { status, code, details });
  }
}
export const operationId = () => crypto.randomUUID();
let browserSession;
async function ownerHeaders(path,body){
  const needs=/^\/api\/providers\/(configure|setup|select|preview-models)$|^\/api\/mcp\/oauth\/(begin|disconnect)$|^\/api\/governance\/(policy|bot|task|tool\/decide)$|^\/api\/(assistance|adaptive|memory|owner-memory|context|goals|compute|plugins|relay|secrets|missions|proactive|workspaces|budgets|playbooks)\//.test(path);
  if(body===undefined||!needs)return {};
  browserSession??=fetch('/api/session',{cache:'no-store'}).then(async r=>{const data=await r.json();if(!r.ok||!data.csrf)throw new ApiError('Reload the FORGE page before performing this Owner action.',403,'BROWSER_SESSION_REQUIRED');return data;}).catch(e=>{browserSession=null;throw e;});
  return {'X-Forge-CSRF':(await browserSession).csrf};
}
export async function request(
  path,
  body,
  method = body === undefined ? "GET" : "POST",
) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json",...await ownerHeaders(path,body) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if(error instanceof ApiError)throw error;
    throw new ApiError(
      "Connection lost. Refresh state before retrying; the server may have completed this action.",
      0,
      "CONNECTION_LOST",
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok)
    {if(data?.error?.code==='BROWSER_SESSION_REQUIRED')browserSession=null;
    throw new ApiError(
      data?.error?.message || `HTTP ${response.status}`,
      response.status,
      data?.error?.code,
      data?.error?.details,
    );}
  return data;
}
export function command(type, projectId, data, entity, opId = operationId()) {
  return request("/api/command", {
    operationId: opId,
    type,
    ...(projectId ? { projectId } : {}),
    ...(entity ? { id: entity.id, expectedRevision: entity.revision } : {}),
    data,
  });
}
export const scoped = (state, collection, projectId) =>
  (state?.[collection] || []).filter((item) => item.projectId === projectId);
export function safeLocalUrl(value) {
  const url = new URL(value, window.location.origin);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  )
    throw new Error("Expected a loopback T3 URL.");
  return url.href;
}
export const downloadUrl = (id) =>
  `/api/artifacts/${encodeURIComponent(id)}/download`;
export async function runEvents(id) {
  const response = await fetch(`/api/runs/${encodeURIComponent(id)}/events`);
  if (!response.ok)
    throw new ApiError(
      `Event projection HTTP ${response.status}`,
      response.status,
    );
  // This endpoint is a finite persisted SSE projection. Parsing never executes tools.
  const text = await response.text();
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5).trim()));
}
export const date = (value) => (value ? new Date(value).toLocaleString() : "—");
export function boundedSheetEdit(range, text) {
  const match =
    /^([A-Z]{1,3})([1-9]\d{0,5})(?::([A-Z]{1,3})([1-9]\d{0,5}))?$/.exec(
      range.toUpperCase().trim(),
    );
  if (!match) throw new Error("Use a bounded A1 range, such as A1:B3.");
  const col = (letters) =>
    [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  const width = col(match[3] || match[1]) - col(match[1]) + 1;
  const height = Number(match[4] || match[2]) - Number(match[2]) + 1;
  if (
    width < 1 ||
    height < 1 ||
    width * height > 1000 ||
    col(match[3] || match[1]) > 16384
  )
    throw new Error("Select 1–1000 cells within the worksheet bounds.");
  const values = text
    .replace(/\r/g, "")
    .split("\n")
    .map((row) =>
      row
        .split("\t")
        .map((cell) => (cell.startsWith("=") ? { f: cell } : cell)),
    );
  if (values.length !== height || values.some((row) => row.length !== width))
    throw new Error(
      `Expected ${height} rows and ${width} columns (tab-separated).`,
    );
  return { range: range.toUpperCase().trim(), values };
}
export function assertDurableSnapshot(snapshot) {
  const serialized = JSON.stringify(snapshot);
  if (/blob:|file:|filesystem:/.test(serialized))
    throw new Error(
      "Temporary/local asset URLs cannot be saved. Use durable project resources or remove the asset first.",
    );
  if (serialized.length > 12_000_000)
    throw new Error("Snapshot exceeds the local 12 MB editor limit.");
  return snapshot;
}
