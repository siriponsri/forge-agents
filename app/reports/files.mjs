import { createHash } from 'node:crypto';
import { readFile, realpath, stat, lstat, mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

export function fault(code, message, statusCode = 400, details) {
  return Object.assign(new Error(message), { code, statusCode, details });
}
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const digestFile = async path => sha256(await readFile(path));
export function beneath(root, path) {
  const rel = relative(resolve(root), resolve(path));
  if (rel === '..' || rel.startsWith(`..\\`) || rel.startsWith('../') || isAbsolute(rel)) {
    throw fault('PATH_SCOPE', 'File is outside the project-owned root.', 403);
  }
  return resolve(path);
}
export async function checkedFile(root, path, max = 128 * 1024 * 1024) {
  beneath(root, path);
  const canonical = await realpath(path);
  beneath(await realpath(root), canonical);
  const info = await stat(canonical);
  if (!info.isFile() || !info.size || info.size > max) throw fault('INVALID_OUTPUT', 'File is empty, oversized or not a regular file.', 422);
  return { path: canonical, bytes: await readFile(canonical), size: info.size };
}
export async function atomicJSON(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { flag: 'wx' });
  await rename(temp, path);
}

// Bounded ZIP reader shared by OOXML validation and fixed official portable packages.
// Checks the central directory, decompressed lengths and CRCs; never extracts links.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function unzip(bytes, maxTotal = 1024 * 1024 * 1024) {
  try {
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
    }
    if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw Error('missing ZIP directory');
    const count = bytes.readUInt16LE(end + 10);
    let pos = bytes.readUInt32LE(end + 16), total = 0;
    if (!count || count > 20000) throw Error('invalid ZIP entry count');
    const files = new Map();
    for (let n = 0; n < count; n++) {
      if (bytes.readUInt32LE(pos) !== 0x02014b50) throw Error('invalid ZIP directory');
      const flags = bytes.readUInt16LE(pos + 8), method = bytes.readUInt16LE(pos + 10);
      const crc = bytes.readUInt32LE(pos + 16), packed = bytes.readUInt32LE(pos + 20), size = bytes.readUInt32LE(pos + 24);
      const len = bytes.readUInt16LE(pos + 28), extra = bytes.readUInt16LE(pos + 30), comment = bytes.readUInt16LE(pos + 32);
      const mode = bytes.readUInt32LE(pos + 38) >>> 16, local = bytes.readUInt32LE(pos + 42);
      const name = bytes.subarray(pos + 46, pos + 46 + len).toString('utf8');
      pos += 46 + len + extra + comment;
      if (!name || /[\\:\x00]/.test(name) || name.startsWith('/') || name.split('/').includes('..') || (mode & 0xf000) === 0xa000 || files.has(name)) throw Error('unsafe ZIP entry');
      if (flags & 1 || ![0, 8].includes(method) || (total += size) > maxTotal || size > 512 * 1024 * 1024) throw Error('unsupported or oversized ZIP');
      if (bytes.readUInt32LE(local) !== 0x04034b50) throw Error('invalid local ZIP entry');
      const localNameLength = bytes.readUInt16LE(local + 26);
      if (bytes.subarray(local + 30, local + 30 + localNameLength).toString('utf8') !== name) throw Error('ZIP entry names disagree');
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      if (start + packed > bytes.length) throw Error('truncated ZIP');
      const content = method === 8 ? inflateRawSync(bytes.subarray(start, start + packed), { maxOutputLength: Math.max(1, size) }) : bytes.subarray(start, start + packed);
      if (content.length !== size || crc32(content) !== crc) throw Error('ZIP size/checksum mismatch');
      files.set(name, content);
    }
    if (pos > end) throw Error('invalid ZIP bounds');
    return files;
  } catch (e) { throw fault('INVALID_ARCHIVE', `Unreadable ZIP: ${e.message}`, 422); }
}
export function validateBytes(kind, bytes) {
  if (kind === 'docx') {
    const files = unzip(bytes, 128 * 1024 * 1024);
    for (const required of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']) {
      if (!files.get(required)?.length) throw fault('INVALID_OUTPUT', `DOCX is missing ${required}.`, 422);
    }
    if (!files.get('word/document.xml').toString('utf8').includes('</w:document>')) throw fault('INVALID_OUTPUT', 'Incomplete DOCX document XML.', 422);
  } else if (kind === 'pdf') {
    if (bytes.subarray(0, 5).toString() !== '%PDF-' || !bytes.subarray(-2048).toString('latin1').includes('%%EOF')) throw fault('INVALID_OUTPUT', 'Incomplete PDF bytes.', 422);
  } else if (kind === 'png') {
    if (bytes.length < 45 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.subarray(-8, -4).toString() !== 'IEND') throw fault('INVALID_OUTPUT', 'Incomplete PNG preview.', 422);
  }
}
export async function extractPackage(bytes, target) {
  // target is a fresh randomly named directory owned by the dependency manager.
  await mkdir(target, { recursive: false });
  for (const [name, data] of unzip(bytes)) {
    const path = beneath(target, join(target, name));
    if (name.endsWith('/')) { await mkdir(path, { recursive: true }); continue; }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { flag: 'wx' });
  }
}
export async function noLinkDirectory(root) {
  await mkdir(root, { recursive: true });
  if ((await lstat(root)).isSymbolicLink()) throw fault('PATH_SCOPE', 'Report storage root must not be a link.', 403);
  return realpath(root);
}
