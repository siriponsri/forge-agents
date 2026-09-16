import fs from 'node:fs';
import path from 'node:path';
import {assert, canonicalJson, nowIso, redact, sha256, readJson, writeJson} from './core.mjs';
import {verifySnapshot} from './snapshot.mjs';
import {validateTaskGraph} from './task-graph.mjs';
import {validateNormalizedIntelligence} from './model-intelligence.mjs';

export function independentQa({candidateRoot, snapshotManifest, runResult, harnessProof, baseline = {}} = {}) {
  const checks = [];
  const add = (name, pass, detail = '') => checks.push({name, pass: Boolean(pass), detail});
  let snapshotResult;
  try { snapshotResult = verifySnapshot(candidateRoot, snapshotManifest); } catch (error) { snapshotResult = {ok: false, error: error.message}; }
  add('frozen candidate snapshot is exact', snapshotResult.ok, snapshotResult.ok ? snapshotResult.actual : snapshotResult.error);
  let graphPass = false; let modelPass = false;
  try { graphPass = Boolean(validateTaskGraph(runResult.graph).valid); } catch { graphPass = false; }
  try { modelPass = validateNormalizedIntelligence(runResult.normalized).valueOf() === true; } catch { modelPass = false; }
  add('task graph dependency and role contracts', graphPass);
  add('model intelligence normalized contract', modelPass);
  add('dynamic staffing selects only required cells', runResult.staffing?.dynamic === true && runResult.staffing?.permanent_team === false && runResult.staffing.selected_work_cells.length > 0);
  add('route plans are frozen and mutation-free', runResult.routes?.every(item => item.frozen === true && item.production_route_mutation === false));
  add('NOT_RECOMMENDED backends are rejected', runResult.routes?.every(item => item.rejected_routes.every(rejected => !['hive', 'penguin', 'p6-hive', 'p7-penguin'].includes(rejected.route_id) || rejected.reasons.includes('BACKEND_CLASSIFICATION_NOT_RECOMMENDED'))));
  add('CapabilityGrad cannot bypass hard filters', runResult.routes?.every(item => {
    const recommendation = item.capabilitygrad_recommendation;
    if (!recommendation || recommendation.selected_route === null) return true;
    return !item.rejected_routes.some(rejected => rejected.route_id === recommendation.selected_route);
  }));
  add('same fixture normalized across Codex/OpenCode', harnessProof?.same_fixture === true && harnessProof?.outputs_equal === true && harnessProof?.adapters?.length === 2);
  add('no model/provider call required by deterministic fixture', harnessProof?.model_call === false);
  add('P1-P4B preserved baseline', baseline.P1_P4B_preserved === true);
  add('P5/P6/P7 frozen classifications unchanged', baseline.P5 === 'OPTIONAL' && baseline.P6 === 'NOT_RECOMMENDED' && baseline.P7 === 'NOT_RECOMMENDED');
  add('P8/P9 not started', baseline.P8_started === false && baseline.P9_started !== true);
  const pass = checks.every(item => item.pass);
  return redact({schema_version: '1.0.0', qa_id: 'P7.5_INDEPENDENT_QA', independent: true, verdict: pass ? 'PASS' : 'FAIL', created_at: nowIso(), frozen_snapshot_id: snapshotManifest?.snapshot_id ?? null, checks, defects: checks.filter(item => !item.pass), no_silent_repair: true, production_promotion: false});
}

export function runMutationGuard(candidateRoot, snapshotManifest) {
  const result = verifySnapshot(candidateRoot, snapshotManifest);
  assert(result.ok === false, 'mutation guard fixture must detect candidate mutation');
  return result;
}

export function writeQa(outputPath, qa) { return writeJson(outputPath, qa); }
