import { fail } from '../server/domain.mjs';
import { hash, verify, safeRelative } from './common.mjs';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const esc = x => x.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
const metadataFields = 'id,name,mimeType,appProperties,capabilities(canAddChildren),trashed';

// Drive v3 binary objects, resumable uploads, generated IDs and immutable keys.
// No public sharing permissions are created. Folder must be explicitly selected/created by the owner.
export function createDriveAdapter({ folderId, secretRef, auth, fetchImpl = fetch, wait = sleep,signal }) {
  if (typeof folderId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(folderId)) fail('VALIDATION', 'Choose a Google Drive folder');
  async function request(url, options = {}, { accepted = [], retry = true } = {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'www.googleapis.com') fail('DRIVE_PERMISSION', 'Unexpected Drive upload endpoint');
    for (let attempt = 0; ; attempt++) {
      if(signal?.aborted)fail('INTERRUPTED','Storage stopped; inspect staged files before resuming',409);
      let response;
      try { response = await fetchImpl(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${await auth.token(secretRef)}` }, redirect: 'error', signal: signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000) }); }
      catch (e) {
        if(signal?.aborted)fail('INTERRUPTED','Storage stopped; inspect staged files before resuming',409);
        if (e.code === 'AUTH_REQUIRED' || e.code === 'SETUP_REQUIRED') throw e;
        if (!retry || attempt >= 2) fail('DRIVE_UNAVAILABLE', 'Drive request interrupted; retry staged files');
        await wait(250 * 2 ** attempt); continue;
      }
      if (response.ok || accepted.includes(response.status)) return response;
      let reason;
      try { reason = (await response.json()).error?.errors?.[0]?.reason; } catch {}
      const limited = response.status === 429 || (response.status === 403 && ['rateLimitExceeded', 'userRateLimitExceeded'].includes(reason));
      if ((limited || response.status >= 500) && retry && attempt < 2) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(2000, retryAfter * 1000) : 250 * 2 ** attempt); continue;
      }
      fail(response.status === 401 ? 'AUTH_REQUIRED' : limited ? 'DRIVE_RATE_LIMIT' : response.status >= 500 ? 'DRIVE_UNAVAILABLE' : 'DRIVE_PERMISSION', 'Drive request rejected');
    }
  }
  async function listQuery(q) {
    const files = []; let pageToken;
    do {
      const params = new URLSearchParams({ q: `trashed = false and (${q})`, fields: `nextPageToken,files(${metadataFields})`, pageSize: '1000', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', ...(pageToken ? { pageToken } : {}) });
      const response = await request(`${API}/files?${params}`), page = await response.json();
      if (!Array.isArray(page.files)) fail('DRIVE_UNAVAILABLE', 'Drive returned invalid file metadata');
      files.push(...page.files); pageToken = page.nextPageToken;
    } while (pageToken);
    return files;
  }
  async function objects() { return listQuery(`'${esc(folderId)}' in parents and appProperties has { key='forgeStorage' and value='v1' }`); }
  async function locate(key) {
    safeRelative(key);
    const found = (await listQuery(`'${esc(folderId)}' in parents and appProperties has { key='forgeKey' and value='${hash(key)}' }`));
    if (found.length > 1) fail('DRIVE_AMBIGUOUS', 'Duplicate Drive keys require explicit owner resolution', 409);
    return found[0];
  }
  return {
    kind: 'drive',
    async health() {
      const response = await request(`${API}/files/${folderId}?${new URLSearchParams({ fields: metadataFields, supportsAllDrives: 'true' })}`), folder = await response.json();
      if (folder.mimeType !== 'application/vnd.google-apps.folder' || folder.trashed || !folder.capabilities?.canAddChildren) fail('DRIVE_PERMISSION', 'Select a writable Drive folder');
      return { kind: 'drive', status: 'ready', folder: { id: folder.id, name: folder.name }, authentication: 'verified', capabilities: ['read','write','restore','retention','file-resume'] };
    },
    async get(key) {
      const file = await locate(key); if (!file) return null;
      const response = await request(`${API}/files/${file.id}?alt=media&supportsAllDrives=true`);
      return Buffer.from(await response.arrayBuffer());
    },
    async put(key, bytes) {
      const previous = await locate(key);
      if (previous) {
        const response = await request(`${API}/files/${previous.id}?alt=media&supportsAllDrives=true`);
        verify(Buffer.from(await response.arrayBuffer()), hash(bytes), bytes.length); return;
      }
      const generated = await (await request(`${API}/files/generateIds?count=1&space=drive&type=files`)).json();
      const fileId = generated.ids?.[0];
      if (typeof fileId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(fileId)) fail('DRIVE_UNAVAILABLE', 'Drive did not allocate a file ID');
      const meta = { id: fileId, name: key, parents: [folderId], mimeType: 'application/octet-stream', appProperties: { forgeStorage: 'v1', forgeKey: hash(key), forgeSha256: hash(bytes) } };
      // A generated ID makes a lost create response safe to reconcile, instead of creating a second object.
      const start = await request(`${UPLOAD}/files?uploadType=resumable&supportsAllDrives=true`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(bytes.length) }, body: JSON.stringify(meta) }, { accepted: [409] });
      if (start.status !== 409) {
        const session = start.headers.get('location');
        if (!session) fail('DRIVE_UNAVAILABLE', 'Drive resumable upload session unavailable');
        // Session capability URLs are kept in memory only. After process restart, completed files are reused;
        // a partially uploaded single file starts again. This is file-granular resume, not byte-offset recovery across restart.
        let offset = 0;
        do {
          const end = Math.min(offset + 1024 * 1024, bytes.length);
          let response;
          try {
            response = await request(session, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(end - offset), 'Content-Range': bytes.length ? `bytes ${offset}-${end - 1}/${bytes.length}` : 'bytes */0' }, body: bytes.subarray(offset, end) }, { accepted: [308], retry: false });
          } catch (e) {
            if (e.code !== 'DRIVE_UNAVAILABLE') throw e;
            // Query server offset before replaying a chunk whose acknowledgement was lost.
            response = await request(session, { method: 'PUT', headers: { 'Content-Length': '0', 'Content-Range': `bytes */${bytes.length}` } }, { accepted: [308] });
          }
          if (response.status !== 308) break;
          const range = /^bytes=0-(\d+)$/.exec(response.headers.get('range') ?? '');
          const next = range ? Number(range[1]) + 1 : 0;
          if (next < offset || next > bytes.length || next === offset) fail('DRIVE_UNAVAILABLE', 'Drive upload did not advance; retry this file');
          offset = next;
        } while (offset < bytes.length);
      }
      const response = await request(`${API}/files/${fileId}?alt=media&supportsAllDrives=true`);
      verify(Buffer.from(await response.arrayBuffer()), hash(bytes), bytes.length);
    },
    async list(prefix) { safeRelative(prefix); return (await objects()).map(x => x.name).filter(x => typeof x === 'string' && x.startsWith(`${prefix}/`)).sort(); },
    async delete(key) {
      const file = await locate(key); if (!file) return;
      await request(`${API}/files/${file.id}?supportsAllDrives=true`, { method: 'DELETE' }, { accepted: [404] });
    },
    async folders() { return (await listQuery("mimeType = 'application/vnd.google-apps.folder'")).map(f => ({ id: f.id, name: f.name })); },
    async createFolder(name) {
      if (typeof name !== 'string' || !name.trim() || name.length > 120) fail('VALIDATION', 'Enter a folder name');
      // Creation is owner initiated; do not automatically repeat an ambiguous POST.
      const response = await request(`${API}/files?fields=id,name&supportsAllDrives=true`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [folderId] }) }, { retry: false });
      return response.json();
    },
  };
}
