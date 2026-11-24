import { join, basename, isAbsolute } from 'node:path';
import { mkdir, readFile, writeFile, rename, readdir, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { configuration } from './config.mjs';
import { openSession, probeEngine } from './engine.mjs';
import { fault, noLinkDirectory, checkedFile, validateBytes, sha256, atomicJSON, beneath } from './files.mjs';
import { RELEASES, releaseInfo } from './releases.mjs';
import { renderReport, inspectPDF, expectedText, TEMPLATES, validateSpec } from './render.mjs';

const TERMINAL = new Set(['ready', 'failed', 'interrupted', 'unknown']);
const MIME = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf', png: 'image/png' };
const now = () => new Date().toISOString();
const clone = value => structuredClone(value);
const textFingerprint = text => sha256(Buffer.from((text.pages ?? []).map(p => p.text ?? '').join('').normalize('NFC').replace(/\s/g, '').split('').sort().join('')));
function requireId(id, label) { if (typeof id !== 'string' || !id || id.length > 200) throw fault('REPORT_INPUT', `${label} is required.`); }
function belongs(job) { return job?.owner === 'reports'; }

export function createReportService(options) { return createService(options); }

// Adapter injection is for labelled deterministic lifecycle fixtures; the HTTP service
// always constructs createReportService, which uses the verified native adapters.
export function createService({ dataDir, store }, { sessionFactory = openSession, probe = probeEngine } = {}) {
  if (!isAbsolute(dataDir) || !store?.read || !store?.transaction) throw Error('Report service needs absolute dataDir and authoritative store.');
  const base = join(dataDir, 'reports');
  const settings = configuration(base);
  const active = new Map();
  let initialized;
  const jobDir = (job, published = false) => beneath(base, join(base, published ? 'published' : 'staging', job.id));
  const update = (id, fn) => store.transaction(state => {
    const job = state.jobs.find(x => x.id === id && belongs(x));
    if (!job) throw fault('JOB_NOT_FOUND', 'Report job not found.', 404);
    fn(job); job.revision++; job.updatedAt = now(); return clone(job);
  });
  async function validateManifest(job, root) {
    const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
    if (manifest.schemaVersion !== 1 || manifest.jobId !== job.id || manifest.sourceSha256 !== job.sourceSha256 || !Array.isArray(manifest.artifacts) || !manifest.artifacts.length) throw fault('MANIFEST_INVALID', 'Report output manifest does not match its frozen attempt.', 422);
    const required = job.kind === 'report' ? ['docx', 'pdf', 'png'] : job.operation === 'rotate' ? ['pdf', 'png'] : job.operation === 'render' ? ['png'] : [];
    if (required.some(kind => !manifest.artifacts.some(a => a.kind === kind))) throw fault('MANIFEST_INVALID', 'Report manifest has incomplete outputs.', 422);
    for (const item of manifest.artifacts) {
      if (item.filename !== basename(item.filename)) throw fault('MANIFEST_INVALID', 'Unsafe output filename.', 422);
      const file = await checkedFile(root, join(root, item.filename));
      validateBytes(item.kind, file.bytes);
      if (sha256(file.bytes) !== item.sha256 || file.size !== item.size) throw fault('MANIFEST_INVALID', 'Output bytes no longer match the manifest.', 422);
    }
    return manifest;
  }
  async function commit(job, manifest) {
    return store.transaction(state => {
      const live = state.jobs.find(x => x.id === job.id && belongs(x));
      if (live.stopRequestedAt) throw fault('JOB_STOPPED', 'Report stop was requested; staged output remains unpublished.', 409);
      if (live.status === 'ready') return clone(live);
      for (const item of manifest.artifacts) {
        if (!state.artifacts.some(a => a.id === item.id)) state.artifacts.push({ ...item, projectId: job.projectId,
          name: item.filename, filename: item.filename, contentType: MIME[item.kind],
          path: join(jobDir(job, true), item.filename), locations: [{ kind: 'local', path: join(jobDir(job, true), item.filename), verified: true }],
          jobId: job.id, reportId: job.reportId, sourceRevision: job.sourceRevision, sourceSha256: job.sourceSha256,
          parentArtifactIds: job.inputArtifacts.map(x => x.id), lineage: { reportId: job.reportId, sourceRevision: job.sourceRevision, inputs: job.inputArtifacts },
          provenance: manifest.provenance, validation: manifest.validation, bytes: item.size, status: 'verified', revision: 1, createdAt: now(), updatedAt: now() });
      }
      Object.assign(live, { status: 'ready', phase: 'ready', artifactIds: manifest.artifacts.map(x => x.id), validation: manifest.validation,
        provenance: manifest.provenance, progress: { mode: 'indeterminate', phase: 'ready' }, completedAt: now(), updatedAt: now(), revision: live.revision + 1 });
      live.logs.push({ at: now(), phase: 'ready', message: 'Verified local artifacts committed. Destination transfers are separate operations.' });
      return clone(live);
    });
  }
  async function init() {
    if (!initialized) initialized = (async () => {
      await noLinkDirectory(base);
      await noLinkDirectory(join(base, 'staging'));
      await noLinkDirectory(join(base, 'published'));
      const jobs = (await store.read()).jobs.filter(j => belongs(j) && (!TERMINAL.has(j.status) || (j.status === 'unknown' && !j.artifactIds?.length)));
      for (const job of jobs) {
        // A durable completion marker can be reconciled without replaying an engine.
        // Old PIDs are never used to kill processes after restart.
        let recovered = false;
        if (!job.stopRequestedAt) {
          for (const published of [true, false]) {
            try {
              const root = jobDir(job, published);
              const manifest = await validateManifest(job, root);
              if (!published) await rename(root, jobDir(job, true));
              await commit(job, manifest); recovered = true; break;
            } catch { /* unknown is preserved below; never regenerate automatically */ }
          }
        }
        if (!recovered) await update(job.id, j => {
          j.status = 'unknown'; j.phase = 'unknown'; j.progress = { mode: 'indeterminate', phase: 'unknown' };
          j.error = { code: 'RESTART_OUTCOME_UNKNOWN', message: 'Prior engine ownership was lost. Staged output is unpublished. Inspect diagnostics, then start an explicit new operation; this attempt will not replay.' };
        });
      }
    })();
    return initialized;
  }
  async function getJob(id) {
    await init();
    const job = (await store.read()).jobs.find(x => x.id === id && belongs(x));
    if (!job) throw fault('JOB_NOT_FOUND', 'Report job not found.', 404);
    return clone(job);
  }
  async function phase(id, name, message) {
    return update(id, j => {
      if (j.stopRequestedAt) throw fault('JOB_STOPPED', 'Report stop requested.', 409);
      j.phase = name; j.status = name; j.progress = { mode: 'indeterminate', phase: name };
      j.logs.push({ at: now(), phase: name, message });
    });
  }
  async function artifactBytes(artifact, project) {
    if (!isAbsolute(project.workspace ?? '')) throw fault('PROJECT_WORKSPACE', 'Choose an absolute local workspace for this project.', 422);
    const owned = artifact.jobId && belongs((await store.read()).jobs.find(j => j.id === artifact.jobId));
    const root = owned ? join(base, 'published', artifact.jobId) : project.workspace;
    const file = await checkedFile(root, artifact.path);
    if (!artifact.sha256 || sha256(file.bytes) !== artifact.sha256) throw fault('ARTIFACT_CHANGED', 'Input artifact checksum differs from its recorded revision. Register a new verified revision.', 409);
    return file;
  }
  async function run(id) {
    const control = active.get(id);
    let job = await getJob(id);
    const root = jobDir(job);
    const sessions = control.sessions;
    const acquire = async engine => {
      const session = await sessionFactory({ engine, config: control.machineConfig[engine], root,
        signal: control.controller.signal, onSession: s => sessions.add(s), onLog: message => {
          control.engineLogs.push({ at: now(), engine, phase: 'engine', message });
          if (control.engineLogs.length > 40) control.engineLogs.shift();
        } });
      sessions.add(session);
      await update(id, j => { j.processes ??= []; j.processes.push({ engine, pid: session.pid, identity: session.identity, ownership: 'job-session', startedAt: now() }); });
      return session;
    };
    try {
      await phase(id, 'preparing', 'Freezing source inputs in a job-owned directory.');
      for (const font of control.machineConfig.fonts) for (const file of font.files) {
        const bytes = await readFile(file.path).catch(() => { throw fault('FONT_MISSING', `Configured font file for ${font.family} is missing. Restore the font or explicitly choose another profile.`, 422); });
        if (sha256(bytes) !== file.sha256) throw fault('FONT_CHANGED', `Font file for ${font.family} changed. Review and save the new font profile before generation.`, 409);
      }
      await mkdir(root, { recursive: false });
      await writeFile(join(root, 'source.json'), JSON.stringify(job.frozenSource, null, 2), { flag: 'wx' });
      const state = await store.read(), project = state.projects.find(p => p.id === job.projectId);
      const assets = [];
      for (const input of job.inputArtifacts) {
        const artifact = state.artifacts.find(a => a.id === input.id && a.projectId === job.projectId);
        if (!artifact || artifact.revision !== input.revision || artifact.sha256 !== input.sha256) throw fault('INPUT_REVISION', 'A selected input artifact revision changed before staging.', 409);
        const file = await artifactBytes(artifact, project);
        const stagedPath = join(root, `input-${assets.length}.${['png', 'jpg', 'jpeg', 'pdf'].includes(artifact.kind) ? artifact.kind : 'bin'}`);
        await writeFile(stagedPath, file.bytes, { flag: 'wx' });
        assets.push({ ...input, stagedPath });
      }
      await phase(id, 'rendering', 'Running a confined headless engine. Native progress is indeterminate.');
      const provenance = { source: job.frozenSource, sourceSha256: job.sourceSha256, template: job.frozenSource.spec?.template,
        fontProfiles: control.machineConfig.fonts, engines: [], route: job.kind === 'report' ? 'wordcraft-direct-docx-pdf' : `pdfcraft-${job.operation}`, transfers: [] };
      let outputs = [], validation = {};
      if (job.kind === 'report') {
        const word = await acquire('wordcraft'); provenance.engines.push(word.identity);
        const result = await renderReport(word, job.frozenSource.spec, root, assets);
        outputs.push(...result.outputs); validation = result.validation;
        const pdf = await acquire('pdfcraft'); provenance.engines.push(pdf.identity);
        const inspected = await inspectPDF(pdf, join(root, 'report.pdf'), { expected: expectedText(job.frozenSource.spec), root, preview: true });
        outputs.push(...inspected.outputs); Object.assign(validation, inspected.validation);
      } else {
        const pdf = await acquire('pdfcraft'); provenance.engines.push(pdf.identity);
        const input = assets[0];
        let path = input.stagedPath;
        let inputText;
        if (job.operation === 'rotate') {
          const opened = await pdf.call('doc_open', { path });
          inputText = await pdf.call('text_extract', { doc: opened.doc });
          await pdf.call('page_rotate', { doc: opened.doc, degrees: job.frozenSource.degrees, ...(job.frozenSource.pages ? { pages: job.frozenSource.pages } : {}) });
          path = join(root, 'derived.pdf');
          await pdf.call('doc_save', { doc: opened.doc, path, full: true });
          outputs.push({ kind: 'pdf', path });
        }
        const result = await inspectPDF(pdf, path, { root, preview: job.operation !== 'inspect', page: job.frozenSource.page ?? 1 });
        if (inputText && textFingerprint(inputText) !== textFingerprint(result.validation.text)) throw fault('PDF_CONTENT_CHANGED', 'Page rotation changed searchable text content. Derived output was not published.', 422);
        outputs.push(...result.outputs); validation = result.validation;
        if (job.operation === 'inspect') {
          // Inspection is persisted on the job, with no fabricated output artifact.
          await phase(id, 'validating', 'PDF structure and searchable text inspected.');
          for (const session of sessions) await session.close();
          await update(id, j => {
            if (j.stopRequestedAt) throw fault('JOB_STOPPED', 'Stop requested before inspection completion.', 409);
            Object.assign(j, { status: 'ready', phase: 'ready', validation, provenance, completedAt: now(), progress: { mode: 'indeterminate', phase: 'ready' } });
          });
          return;
        }
      }
      await phase(id, 'validating', 'Reopening outputs and verifying expected bytes, formats, content and hashes.');
      const artifacts = [];
      for (const output of outputs) {
        const file = await checkedFile(root, output.path); validateBytes(output.kind, file.bytes);
        artifacts.push({ id: randomUUID(), kind: output.kind, filename: basename(output.path), sha256: sha256(file.bytes), size: file.size });
      }
      for (const session of sessions) {
        const closed = await session.close();
        if (closed?.confirmed === false) throw fault('ENGINE_STOP_UNKNOWN', 'Engine process closure could not be confirmed; outputs remain unpublished.', 409);
      }
      control.controller.signal.throwIfAborted();
      const manifest = { schemaVersion: 1, jobId: id, sourceSha256: job.sourceSha256, artifacts, validation, provenance };
      await atomicJSON(join(root, 'manifest.json'), manifest);
      await validateManifest(job, root);
      await phase(id, 'validating', 'All output checks passed; committing immutable local files.');
      await rename(root, jobDir(job, true));
      await commit(job, manifest);
    } catch (error) {
      const stopped = control.controller.signal.aborted;
      let confirmed = true;
      for (const session of sessions) {
        try { if ((await session.close())?.confirmed === false) confirmed = false; } catch { confirmed = false; }
      }
      const stagedFiles = [];
      for (const name of await readdir(root).catch(() => [])) {
        const info = await stat(join(root, name)).catch(() => null);
        if (info?.isFile()) stagedFiles.push({ name, size: info.size, published: false });
      }
      await update(id, j => {
        if (j.status === 'ready') return;
        j.status = stopped ? (confirmed ? 'interrupted' : 'unknown') : error.code === 'ENGINE_STOP_UNKNOWN' ? 'unknown' : 'failed';
        j.phase = j.status; j.progress = { mode: 'indeterminate', phase: j.status }; j.stagedFiles = stagedFiles;
        j.error = { code: stopped ? 'REPORT_INTERRUPTED' : error.code ?? 'ENGINE_FAILURE', message: stopped ? (confirmed ? 'Owned engine session stopped; staged files were inspected and remain unpublished.' : 'Stop requested but process exit is unconfirmed; output remains unpublished.') : error.message, ...(error.details ? { details: error.details } : {}) };
        j.logs.push({ at: now(), phase: j.phase, message: j.error.message }); j.completedAt = now();
        j.logs.push(...control.engineLogs);
      });
    } finally { active.delete(id); }
  }
  async function start(input, kind) {
    await init(); requireId(input?.operationId, 'operationId'); requireId(input.projectId, 'projectId');
    if (kind === 'report') requireId(input.reportId, 'reportId'); else requireId(input.artifactId, 'artifactId');
    const request = JSON.stringify(kind === 'report' ? { kind, projectId: input.projectId, reportId: input.reportId, expectedRevision: input.expectedRevision } : { kind, projectId: input.projectId, artifactId: input.artifactId, expectedRevision: input.expectedRevision, operation: input.operation, degrees: input.degrees, pages: input.pages, page: input.page });
    const requestSha256 = sha256(Buffer.from(request));
    const prior = (await store.read()).jobs.find(j => j.operationId === input.operationId);
    if (prior) {
      if (!belongs(prior) || prior.requestSha256 !== requestSha256) throw fault('OPERATION_CONFLICT', 'operationId was already used for another request.', 409);
      return publicJob(clone(prior));
    }
    const machineConfig = await settings.read();
    const result = await store.transaction(state => {
      const previous = state.jobs.find(j => j.operationId === input.operationId);
      if (previous) {
        if (!belongs(previous) || previous.requestSha256 !== requestSha256) throw fault('OPERATION_CONFLICT', 'operationId was already used for another request.', 409);
        return { job: clone(previous), duplicate: true };
      }
      if (state.receipts?.some(r => r.operationId === input.operationId)) throw fault('OPERATION_CONFLICT', 'operationId is already used by another command.', 409);
      const project = state.projects.find(p => p.id === input.projectId);
      if (!project) throw fault('PROJECT_NOT_FOUND', 'Project not found.', 404);
      let frozenSource, sourceRevision, inputArtifacts;
      if (kind === 'report') {
        const report = state.reports.find(r => r.id === input.reportId && r.projectId === input.projectId);
        if (!report) throw fault('REPORT_NOT_FOUND', 'Report is not in the selected project.', 404);
        if (report.revision !== input.expectedRevision) throw fault('REVISION_CONFLICT', 'Report changed; refresh and select its current revision.', 409);
        validateSpec(report.spec);
        sourceRevision = report.revision;
        frozenSource = { schemaVersion: 1, projectId: input.projectId, reportId: report.id, sourceRevision, spec: clone(report.spec) };
        frozenSource.inputDocuments=report.spec.inputs.filter(ref=>ref.documentId).map(ref=>{
          const document=state.documents.find(d=>d.id===ref.documentId&&d.projectId===input.projectId);
          const snapshot=document?.revision===ref.revision?document.snapshot:document?.history?.find(h=>h.revision===ref.revision)?.snapshot;
          if(!snapshot||!['univer-doc-text-v1','univer-sheet-range-v1','plain-text-v1'].includes(ref.mapping)||!Number.isInteger(ref.revision))throw fault('INPUT_REVISION','Selected native document revision is unavailable in this project.',409);
          const hash=sha256(Buffer.from(JSON.stringify(snapshot)));
          if(ref.sourceSha256&&ref.sourceSha256!==hash)throw fault('INPUT_REVISION','Selected native document snapshot hash changed.',409);
          return {...ref,sourceSha256:hash,snapshot:clone(snapshot)};
        });
        const refs = [...report.spec.inputs.filter(ref=>!ref.documentId), ...report.spec.sections.filter(s => s.figure).map(s => s.figure)];
        inputArtifacts = refs.map(ref => {
          const a = state.artifacts.find(a => a.id === ref.artifactId && a.projectId === input.projectId);
          if (!a || !Number.isInteger(ref.revision) || a.revision !== ref.revision || !a.sha256) throw fault('INPUT_REVISION', 'Every input/figure needs an explicit existing project artifact revision.', 409);
          return { id: a.id, revision: a.revision, sha256: a.sha256, kind: a.kind };
        }).filter((a, i, all) => all.findIndex(b => b.id === a.id) === i);
      } else {
        if (!['inspect', 'render', 'rotate'].includes(input.operation)) throw fault('PDF_OPERATION', 'Supported PDF operations: inspect, render, rotate.');
        if (input.operation === 'rotate' && ![90, 180, 270, -90, -180, -270].includes(input.degrees)) throw fault('PDF_OPERATION', 'Rotation must be 90, 180 or 270 degrees.');
        if (input.pages && (!Array.isArray(input.pages) || !input.pages.length || input.pages.some(p => !Number.isInteger(p) || p < 1))) throw fault('PDF_OPERATION', 'pages must be positive 1-based page numbers.');
        if (input.page !== undefined && (!Number.isInteger(input.page) || input.page < 1)) throw fault('PDF_OPERATION', 'page must be a positive 1-based page number.');
        const a = state.artifacts.find(a => a.id === input.artifactId && a.projectId === input.projectId && a.kind === 'pdf');
        if (!a) throw fault('ARTIFACT_NOT_FOUND', 'Select a PDF artifact in this project.', 404);
        if (a.revision !== input.expectedRevision) throw fault('REVISION_CONFLICT', 'PDF artifact revision changed.', 409);
        inputArtifacts = [{ id: a.id, revision: a.revision, sha256: a.sha256, kind: a.kind }]; sourceRevision = a.revision;
        frozenSource = { schemaVersion: 1, artifactId: a.id, sourceRevision, operation: input.operation, degrees: input.degrees, pages: input.pages, page: input.page };
      }
      const job = { id: randomUUID(), owner: 'reports', kind, projectId: input.projectId, reportId: input.reportId, operation: input.operation,
        operationId: input.operationId, requestSha256, attemptId: randomUUID(), sourceRevision, frozenSource,
        sourceSha256: sha256(Buffer.from(JSON.stringify(frozenSource))), inputArtifacts,
        status: 'queued', phase: 'queued', progress: { mode: 'indeterminate', phase: 'queued' }, artifactIds: [], logs: [], revision: 1, createdAt: now(), updatedAt: now() };
      state.jobs.push(job);
      return { job: clone(job), duplicate: false };
    });
    if (!result.duplicate) {
      const control = { controller: new AbortController(), sessions: new Set(), promise: null, machineConfig, engineLogs: [] }; active.set(result.job.id, control);
      control.promise = run(result.job.id);
      // Keep a rejection observed if persistence itself fails; never claim ready.
      control.promise.catch(() => {});
    }
    return publicJob(result.job);
  }
  function publicJob(job) { const { machineConfig, ...visible } = job; return visible; }
  return {
    async health() {
      await init();
      const config = await settings.read();
      const engines = Object.fromEntries(await Promise.all(Object.keys(RELEASES).map(async engine => [engine, { ...await probe(engine, config[engine], base), release: releaseInfo(engine) }])));
      const fontProfiles = await Promise.all(config.fonts.map(async font => {
        let status = engines.wordcraft.ready ? (engines.wordcraft.fonts?.families?.includes(font.family) ? 'available' : 'missing_font') : 'engine_unavailable';
        for (const file of font.files) {
          try { if (sha256(await readFile(file.path)) !== file.sha256) status = 'changed_font'; }
          catch { status = 'missing_font'; }
        }
        return { family: font.family, version: font.version, status,
          ...(status === 'available' ? {} : { recovery: 'Install the chosen font or explicitly select/save another available font profile.' }) };
      }));
      return { schemaVersion: 1, ready: engines.wordcraft.ready && engines.pdfcraft.ready, engines, fontProfiles, templates: TEMPLATES, config,
        setup: { actions: ['discover', 'install', 'reset'], platform: 'win32-x64', checksumPolicy: 'Pinned archive SHA256 plus executable SHA256; version and discovered schemas checked before use.' },
        capabilities: { report: engines.wordcraft.ready && engines.pdfcraft.ready, pdfInspect: engines.pdfcraft.ready, pdfRender: engines.pdfcraft.ready, pdfRotate: engines.pdfcraft.ready,
          officeConversion: { ready: false, reason: 'LibreOffice-backed route is not enabled or qualified. Report generation uses direct WordCraft PDF.' },
          exchange: { ready: false, reason: 'Optional separately licensed Univer Exchange is independent of report rendering and native editing.' } } };
    },
    async configure(config) { await init(); await settings.update(config); return this.health(); },
    generate: input => start(input, 'report'),
    pdfOperation: input => start(input, 'pdf'),
    async getJob(id) { return publicJob(await getJob(id)); },
    async stop(id) {
      const job = await getJob(id);
      if (TERMINAL.has(job.status)) return publicJob(job);
      const marked = await update(id, j => { if (!TERMINAL.has(j.status)) { j.stopRequestedAt = now(); j.status = 'stopping'; j.phase = 'stopping'; } });
      if (TERMINAL.has(marked.status)) return publicJob(marked);
      const control = active.get(id);
      if (!control) return publicJob(await update(id, j => { j.status = 'unknown'; j.phase = 'unknown'; }));
      control.controller.abort();
      await Promise.allSettled([...control.sessions].map(s => s.close()));
      await control.promise;
      return publicJob(await getJob(id));
    },
    async download(artifactId) {
      await init();
      const state = await store.read();
      const artifact = state.artifacts.find(a => a.id === artifactId);
      if (!artifact || !belongs(state.jobs.find(j => j.id === artifact.jobId && j.status === 'ready'))) throw fault('ARTIFACT_NOT_FOUND', 'Verified report artifact not found.', 404);
      const file = await checkedFile(jobDir({ id: artifact.jobId }, true), artifact.path);
      validateBytes(artifact.kind, file.bytes);
      if (sha256(file.bytes) !== artifact.sha256) throw fault('ARTIFACT_CHANGED', 'Published output checksum changed. Restore the original bytes or generate a new attempt.', 409);
      return { path: file.path, contentType: MIME[artifact.kind], filename: artifact.filename };
    },
    async shutdown() { await Promise.allSettled([...active.keys()].map(id => this.stop(id))); },
  };
}
