import { join, delimiter } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { atomicJSON, fault, extractPackage, sha256, digestFile, noLinkDirectory } from './files.mjs';
import { RELEASES, releaseInfo } from './releases.mjs';
import { verifyEngine } from './engine.mjs';

export function configuration(base) {
  const file = join(base, 'machine-settings.json');
  let queue = Promise.resolve();
  async function read() {
    try {
      const config = JSON.parse(await readFile(file, 'utf8'));
      if (config.schemaVersion !== 1 || !Array.isArray(config.fonts) || config.fonts.some(f => typeof f.family !== 'string' || !Array.isArray(f.files) || f.files.some(x => typeof x.path !== 'string' || !/^[a-f0-9]{64}$/.test(x.sha256))) || ['wordcraft', 'pdfcraft'].some(e => config[e] !== null && typeof config[e]?.path !== 'string')) throw Error('unsupported or invalid schema');
      return config;
    } catch (e) {
      if (e.code === 'ENOENT') return { schemaVersion: 1, wordcraft: null, pdfcraft: null, fonts: [] };
      throw fault('ENGINE_CONFIG_CORRUPT', `Report machine settings cannot be read: ${e.message}. Restore or explicitly reset report Settings.`, 503);
    }
  }
  async function discover(engine) {
    const dirs = [
      ...(process.env.PATH ?? '').split(delimiter),
      join(process.env.LOCALAPPDATA ?? base, 'Programs', 'ArtCraft', engine === 'wordcraft' ? 'WordCraft' : 'PdfCraft'),
      join(process.env.PROGRAMFILES ?? base, 'ArtCraft', engine === 'wordcraft' ? 'WordCraft' : 'PdfCraft'),
    ].filter(Boolean);
    const owned = join(base, 'engines');
    const walk = async (dir, depth) => {
      for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory() && depth) await walk(join(dir, entry.name), depth - 1);
        if (entry.isFile() && entry.name === `${engine}-cli.exe`) dirs.push(dir);
      }
    };
    await walk(owned, 3);
    for (const dir of new Set(dirs)) {
      const candidate = { path: join(dir, `${engine}-cli.exe`) };
      try { await verifyEngine(engine, candidate); return candidate; } catch { /* keep looking for the qualified hash */ }
    }
    throw fault('ENGINE_NOT_INSTALLED', `No qualified ${engine} CLI found. Choose Install to acquire the pinned official portable package.`, 503);
  }
  async function install(engine) {
    if (process.platform !== 'win32' || process.arch !== 'x64') throw fault('ENGINE_PLATFORM', 'Automatic acquisition is qualified for Windows x64 only.', 503);
    const pin = releaseInfo(engine);
    const engines = await noLinkDirectory(join(base, 'engines'));
    const target = join(engines, `${engine}-${pin.version}-${randomUUID()}`);
    const response = await fetch(pin.url, { signal: AbortSignal.timeout(180000), redirect: 'follow' });
    if (!response.ok) throw fault('ENGINE_DOWNLOAD', `Official release download failed (${response.status}). Retry or select an existing qualified CLI.`, 502);
    const chunks = []; let total = 0;
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > 180 * 1024 * 1024) throw fault('ENGINE_DOWNLOAD', 'Release download exceeded the pinned package size limit.', 422);
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (sha256(bytes) !== pin.sha256) throw fault('ENGINE_CHECKSUM', 'Downloaded archive checksum differs from the qualified release. Nothing installed.', 422);
    await extractPackage(bytes, target);
    const config = { path: join(target, pin.asset.replace('.zip', ''), `${engine}-cli.exe`), archiveSha256: pin.sha256, installedAt: new Date().toISOString() };
    await verifyEngine(engine, config);
    return config;
  }
  return {
    read,
    update(input) {
      const task = queue.then(async () => {
        if (!input || typeof input !== 'object') throw fault('ENGINE_CONFIG', 'Configuration must be an object.');
        const config = input.action === 'reset' ? { schemaVersion: 1, wordcraft: null, pdfcraft: null, fonts: [] } : await read();
        if (input.action && !['reset', 'discover', 'install'].includes(input.action)) throw fault('ENGINE_CONFIG', 'Unknown setup action.');
        if (['discover', 'install'].includes(input.action)) {
          if (!Object.hasOwn(RELEASES, input.engine)) throw fault('ENGINE_CONFIG', 'Choose wordcraft or pdfcraft.');
          config[input.engine] = await (input.action === 'install' ? install(input.engine) : discover(input.engine));
        }
        for (const engine of Object.keys(RELEASES)) if (Object.hasOwn(input, engine)) {
          if (input[engine] === null) config[engine] = null;
          else { await verifyEngine(engine, input[engine]); config[engine] = { path: input[engine].path }; }
        }
        if (Object.hasOwn(input, 'fonts')) {
          if (!Array.isArray(input.fonts) || input.fonts.length > 100) throw fault('FONT_CONFIG', 'Choose at most 100 named font profiles.');
          config.fonts = [];
          for (const font of input.fonts) {
            if (!font.family || typeof font.family !== 'string') throw fault('FONT_CONFIG', 'Each font profile needs a family name.');
            const files = [];
            if (font.paths !== undefined && (!Array.isArray(font.paths) || font.paths.length > 20)) throw fault('FONT_CONFIG', 'Font paths must be a list of at most 20 font files.');
            for (const path of font.paths ?? []) {
              try { files.push({ path, sha256: await digestFile(path) }); }
              catch { throw fault('FONT_MISSING', `Font file for ${font.family} is missing or unreadable. Choose an installed font file.`, 422); }
            }
            config.fonts.push({ family: font.family, version: font.version ?? 'system-version-unrecorded', license: font.license ?? 'not-redistributed; local system font', files });
          }
        }
        await atomicJSON(file, config);
        return config;
      });
      queue = task.catch(() => {});
      return task;
    },
  };
}
