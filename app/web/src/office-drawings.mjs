// FORGE owns uploaded bytes; Univer owns native drawing commands and undo state.
import { ApiError, assertDurableSnapshot, downloadUrl, operationId, ownerHeaders } from './api.mjs';

export const IMAGE_RESOURCE = 'FORGE_IMAGE_ASSETS_V1';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const artifactURL = /^\/api\/artifacts\/([a-zA-Z0-9-]+)\/download$/;
const assetKey = (asset) => asset.source;

function validateAsset(asset, projectId) {
  if (!asset || asset.projectId !== projectId ||
      !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      !/^[a-zA-Z0-9-]+$/.test(asset.artifactId) ||
      asset.source !== downloadUrl(asset.artifactId) ||
      !['image/png', 'image/jpeg'].includes(asset.mimeType))
    throw new Error('Image resource is invalid or belongs to another project.');
  return asset;
}

export function imageAssets(snapshot, projectId) {
  const resources = (snapshot?.resources || []).filter(r => r.name === IMAGE_RESOURCE);
  if (resources.length > 1) throw new Error('Duplicate FORGE image resource manifests.');
  if (!resources.length) return [];
  let manifest;
  try { manifest = JSON.parse(resources[0].data); } catch {
    throw new Error('Image resource manifest is unreadable. Download the snapshot for recovery.');
  }
  if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.assets))
    throw new Error('Unsupported image resource manifest version.');
  return manifest.assets.map(asset => validateAsset(asset, projectId));
}

// Read serialized plugin resources as well as the native Docs drawing structures.
function visitImages(value, visit) {
  if (!value || typeof value !== 'object') return;
  // Shapes are native vector drawings; their generated SVG sources are plugin data.
  if ('imageSourceType' in value && 'source' in value && value.drawingType !== 1) visit(value);
  for (const [key, child] of Object.entries(value)) {
    if (key === 'data' && typeof child === 'string') {
      try { visitImages(JSON.parse(child), visit); } catch (error) {
        // Non-JSON resources belong to their plugin. Validation errors must propagate.
        if (!(error instanceof SyntaxError)) throw error;
      }
    } else visitImages(child, visit);
  }
}

export function snapshotWithImages(snapshot, assets, projectId, { validate = true } = {}) {
  snapshot = structuredClone(snapshot);
  snapshot.resources = (snapshot.resources || []).filter(r => r.name !== IMAGE_RESOURCE);
  const byURL = new Map(assets.map(asset => [assetKey(validateAsset(asset, projectId)), asset]));
  const used = new Map();
  visitImages(snapshot, image => {
    const asset = byURL.get(image.source);
    if (validate && (image.imageSourceType !== 'URL' || !artifactURL.test(image.source) || !asset))
      throw new Error('Upload this image as a project PNG or JPEG before saving. Its source is not a durable project resource.');
    if (asset) used.set(image.source, asset);
  });
  if (used.size) snapshot.resources.push({
    name: IMAGE_RESOURCE,
    data: JSON.stringify({ version: 1, assets: [...used.values()].sort((a, b) => a.source.localeCompare(b.source)) }),
  });
  return validate ? assertDurableSnapshot(snapshot) : snapshot;
}

function bytesBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}

function decodeImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The selected PNG/JPEG could not be decoded.'));
    image.src = source;
  });
}

// ImageIoService and the identifier are public exports of the matching presets.
// Inherit its public observable/wait contract, without accessing private SDK fields.
export function createProjectImageIO(ImageIoService, { projectId, assets = [] }) {
  if (!projectId) throw new Error('Images require an owning project.');
  return new class extends ImageIoService {
    assets = new Map(assets.map(asset => [assetKey(validateAsset(asset, projectId)), asset]));
    cache = new Map();
    operations = new WeakMap();
    controllers = new Set();
    waiting = 0;
    disposed = false;
    setWaitCount(count) { this.waiting = Math.max(0, count); super.setWaitCount(this.waiting); }
    getImageSourceCache(source) { return this.cache.get(source); }
    addImageSourceCache(source, _type, image) { if (!this.disposed && image) this.cache.set(source, image); }
    async getImage(source) {
      if (!this.assets.has(source)) throw new Error('Unknown project image resource.');
      return source;
    }
    assertOpen() { if (this.disposed) throw new Error('This document editor has closed.'); }
    async uploadImage(file) {
      this.assertOpen();
      if (!file || typeof file.arrayBuffer !== 'function' || !file.size || file.size > MAX_IMAGE_BYTES)
        throw new Error('Choose a nonempty PNG or JPEG up to 5 MB.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const png = [137,80,78,71,13,10,26,10].every((b, i) => bytes[i] === b);
      const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      if (!png && !jpg) throw new Error('Only PNG and JPEG images are supported.');
      const mimeType = png ? 'image/png' : 'image/jpeg', base64 = bytesBase64(bytes);
      const image = await decodeImage(`data:${mimeType};base64,${base64}`);
      this.assertOpen();
      // File identity retains the operation ID on a deliberate retry after a lost response.
      if (!this.operations.has(file)) this.operations.set(file, operationId());
      const name = (file.name || 'image').replace(/\.[^.]*$/, '').replace(/[\\/\x00-\x1f]/g, '_').slice(0, 165) || 'image';
      const controller = new AbortController();
      this.controllers.add(controller);
      try {
        let response;
        try {
          response = await fetch('/api/artifacts/upload', {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...await ownerHeaders('/api/artifacts/upload', {}) }, signal: controller.signal,
            body: JSON.stringify({ operationId: this.operations.get(file), projectId,
              name: `${name}.${png ? 'png' : 'jpg'}`, kind: 'figure', base64 }),
          });
        } catch {
          this.assertOpen();
          throw new ApiError('Image upload connection lost. Retry the same file; the server may already have stored it.', 0, 'CONNECTION_LOST');
        }
        const artifact = await response.json().catch(() => null);
        if (!response.ok) throw new ApiError(artifact?.error?.message || `Image upload HTTP ${response.status}`,
          response.status, artifact?.error?.code);
        this.assertOpen();
        const localHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
          .map(b => b.toString(16).padStart(2, '0')).join('');
        this.assertOpen();
        if (artifact?.sha256 !== localHash || artifact?.bytes !== bytes.length)
          throw new Error('Image upload integrity check failed. The document has not been changed.');
        const asset = validateAsset({ artifactId: artifact.id, projectId: artifact.projectId,
          source: downloadUrl(artifact.id), sha256: artifact.sha256, bytes: artifact.bytes,
          name: artifact.name, mimeType }, projectId);
        this.assets.set(asset.source, asset);
        this.addImageSourceCache(asset.source, 'URL', image);
        return { ...asset, width: image.naturalWidth, height: image.naturalHeight };
      } finally { this.controllers.delete(controller); }
    }
    async saveImage(file) {
      try {
        const asset = await this.uploadImage(file);
        return { imageId: crypto.randomUUID(), imageSourceType: 'URL', source: asset.source,
          // Upstream UI decodes this field for sizing; a durable URL works here too.
          base64Cache: asset.source, status: '0' };
      } catch (error) {
        // Native picker controllers only display the public numeric upload statuses.
        // The FORGE helper keeps the original actionable error for its caller.
        const status = file?.size > MAX_IMAGE_BYTES ? '1' : /Only PNG and JPEG/.test(error.message) ? '2' : '4';
        throw new Error(status, { cause: error });
      } finally { this.setWaitCount(this.waiting - 1); }
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      for (const controller of this.controllers) controller.abort();
      this.controllers.clear(); this.cache.clear(); this.assets.clear();
      this.operations = new WeakMap();
      this.setWaitCount(0);
    }
  }();
}

export function resolveSheet(unit, sheetId) {
  const sheet = sheetId === undefined ? unit.getActiveSheet() :
    typeof sheetId === 'string' && sheetId ? unit.getSheetBySheetId(sheetId) : null;
  if (!sheet) throw new Error('The requested worksheet is unavailable.');
  return sheet;
}

export async function insertProjectImage({ io, unit, kind, file, options = {} }) {
  io.assertOpen();
  const sheet = kind === 'sheet' ? resolveSheet(unit, options.sheetId) : null;
  const index = options.index ?? 0;
  if (kind === 'doc' && (!Number.isSafeInteger(index) || index < 0 || index > unit.getBody().dataStream.length - 2))
    throw new Error('Choose an existing document text offset.');
  const row = options.row ?? 0, column = options.column ?? 0;
  if (sheet && (!Number.isSafeInteger(row) || !Number.isSafeInteger(column) || row < 0 || column < 0 ||
      row >= sheet.getMaxRows() || column >= sheet.getMaxColumns()))
    throw new Error('Choose an image anchor within the worksheet.');
  for (const size of [options.width, options.height])
    if (size !== undefined && (!Number.isFinite(size) || size < 1 || size > 10000))
      throw new Error('Image dimensions must be between 1 and 10000 pixels.');
  const asset = await io.uploadImage(file);
  io.assertOpen();
  const scale = Math.min(1, 500 / asset.width, 500 / asset.height);
  const width = options.width ?? (options.height ? asset.width * options.height / asset.height : asset.width * scale);
  const height = options.height ?? (options.width ? asset.height * options.width / asset.width : asset.height * scale);
  let imageId;
  if (sheet) {
    const image = await sheet.newOverGridImage().setSource(asset.source, 'URL')
      .setColumn(column).setRow(row).setWidth(width).setHeight(height).buildAsync();
    io.assertOpen();
    sheet.insertImages([image]);
    imageId = image.drawingId;
    if (!sheet.getImageById(imageId)) throw new Error('The worksheet rejected the image insertion.');
  } else {
    const image = await unit.insertImage({ source: asset.source, imageSourceType: 'URL',
      width, height, textRange: { startOffset: index, endOffset: index, collapsed: true } });
    if (!image) throw new Error('The document rejected the image insertion.');
    imageId = image.getId();
  }
  return { artifactId: asset.artifactId, sha256: asset.sha256, source: asset.source, imageId,
    region: sheet ? `${sheet.getSheetId()}!image:${imageId}` : `body:${index}`, summary: `Insert image ${asset.name}` };
}
