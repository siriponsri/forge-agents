// Research diagnostic only. Source integrity is NEVER runtime qualification.
// No provider, network, subprocess, configuration write or execution API.
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const pins = JSON.parse(await readFile(new URL('./source-pins.json', import.meta.url), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const error = code => Object.assign(new Error(code), { code });

/** Verify selected source bytes against the primary revisions reviewed here.
 * The input is a pair of local UPSTREAM SOURCE directories, never account homes.
 * This does not inspect an executable, its effective policy, tools or a session.
 * In particular it cannot supply proactive/enforcement.mjs with a proof.
 */
export async function auditUpstream(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).sort().join(',') !== 'opencode,t3' ||
      Object.values(input).some(value => typeof value !== 'string' || !value.trim() || value.includes('\0')))
    throw error('SOURCE_ROOTS_REQUIRED');
  const sources = [];
  for (const pin of pins.sources) {
    const root = path.resolve(input[pin.id]);
    try { if (!(await stat(root)).isDirectory()) throw error('SOURCE_ROOT_UNAVAILABLE'); }
    catch { throw error('SOURCE_ROOT_UNAVAILABLE'); }
    const files = [];
    for (const entry of pin.files) {
      let bytes;
      try { bytes = await readFile(path.join(root, ...entry.path.split('/'))); }
      catch { throw error('SOURCE_FILE_UNAVAILABLE'); }
      // Git's Windows checkout may use CRLF. Preserve the raw hash separately.
      const sha256 = hash(bytes.toString('utf8').replaceAll('\r\n', '\n'));
      if (sha256 !== entry.sha256LF) throw error('SOURCE_REVISION_MISMATCH');
      files.push({ path: entry.path, sha256LF: sha256, sha256Raw: hash(bytes) });
    }
    sources.push({ id: pin.id, version: pin.version, revision: pin.revision, license: pin.license, files });
  }
  return {
    version: 1,
    kind: 'selected-primary-source-audit',
    sourceIntegrity: 'VERIFIED',
    automaticExecutionQualified: false,
    runtimeEnforcement: 'NOT_TESTED_BY_SOURCE_AUDIT',
    proof: null,
    findings: structuredClone(pins.findings),
    sources,
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 4) throw error('USAGE: node app/proactive-native/audit-upstream.mjs <T3-source-root> <OpenCode-source-root>');
    const report = await auditUpstream({ t3: process.argv[2], opencode: process.argv[3] });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (failure) {
    // Do not emit source bytes, environment, account details or physical paths.
    process.stderr.write(`${failure.code ?? 'SOURCE_AUDIT_FAILED'}\n`);
    process.exitCode = 1;
  }
}
