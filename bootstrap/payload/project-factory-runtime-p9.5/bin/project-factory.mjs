#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createProjectIntake} from '../src/intake.mjs';
import {normalizeModelIntelligence, validateNormalizedIntelligence} from '../src/model-intelligence.mjs';
import {deriveTaskGraph, validateTaskGraph} from '../src/task-graph.mjs';
import {selectWorkCells} from '../src/staffing.mjs';
import {buildRoutePlan} from '../src/routing.mjs';
import {runProjectFactory} from '../src/runtime.mjs';
import {runHarnessSwitchProof} from '../src/harness.mjs';
import {createSnapshot, freezeCandidate} from '../src/snapshot.mjs';
import {independentQa, writeQa} from '../src/qa.mjs';
import {readJson, writeJson} from '../src/core.mjs';
import {runP8ToolPlane} from '../src/p8-runtime.mjs';
import {independentP8Qa} from '../src/p8-qa.mjs';

function value(args, flag, fallback = null) { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function has(args, flag) { return args.includes(flag); }
function help() { console.log(`Project Factory Runtime P8\n\nCommands:\n  intake --goal <text> --project-root <dir> --output <json> [--profile BALANCED]\n  normalize-model-intelligence --input <dir> --output <json>\n  graph --intake <json> --output <json>\n  staff --graph <json> --output <json>\n  route --task <json> --intake <json> --model-intelligence <json> --output <json> [--capability-grad]\n  run-demo --goal <text> --project-root <dir> --input <dir> [--profile BALANCED] [--no-harness-proof]\n  p8-run --input <dir> --evidence-root <dir> --runtime-root <dir> --output <json>\n  harness-switch --fixture-root <dir> --output-root <dir>\n  freeze --candidate-root <dir> --output <json>\n  qa --candidate-root <dir> --snapshot <json> --run <json> --proof <json> --baseline <json> --output <json>`); }

async function main() {
  const args = process.argv.slice(2); const command = args[0];
  if (!command || command === '--help' || command === 'help') return help();
  if (command === 'intake') { const result = createProjectIntake({owner_goal: value(args, '--goal'), project_root: value(args, '--project-root'), execution_profile: value(args, '--profile', 'BALANCED')}); writeJson(value(args, '--output'), result); return console.log(JSON.stringify({status: 'PASS', intake_id: result.intake_id})); }
  if (command === 'normalize-model-intelligence') { const result = normalizeModelIntelligence(value(args, '--input')); validateNormalizedIntelligence(result); writeJson(value(args, '--output'), result); return console.log(JSON.stringify({status: 'PASS', models: result.counts.models, providers: result.counts.providers, evidence: result.counts.evidence, freshness: result.freshness_summary})); }
  if (command === 'graph') { const result = deriveTaskGraph(readJson(value(args, '--intake'))); validateTaskGraph(result); writeJson(value(args, '--output'), result); return console.log(JSON.stringify({status: 'PASS', tasks: result.tasks.length, graph_id: result.graph_id})); }
  if (command === 'staff') { const result = selectWorkCells(readJson(value(args, '--graph'))); writeJson(value(args, '--output'), result); return console.log(JSON.stringify({status: 'PASS', cells: result.selected_work_cells.map(item => item.work_cell_id)})); }
  if (command === 'route') { const result = await buildRoutePlan({task: readJson(value(args, '--task')), intake: readJson(value(args, '--intake')), normalized: readJson(value(args, '--model-intelligence')), capabilityGradEnabled: has(args, '--capability-grad')}); writeJson(value(args, '--output'), result); return console.log(JSON.stringify({status: 'PASS', selected_route: result.chosen_harness, rejected: result.rejected_routes.length})); }
  if (command === 'run-demo') { const result = await runProjectFactory({owner_goal: value(args, '--goal'), project_root: value(args, '--project-root'), input_root: value(args, '--input'), execution_profile: value(args, '--profile', 'BALANCED'), capabilityGradEnabled: !has(args, '--no-capability-grad'), runHarnessProof: !has(args, '--no-harness-proof')}); return console.log(JSON.stringify({status: 'PASS', run_id: result.run_id, state_root: result.intake.state_root, task_count: result.graph.tasks.length, selected_cells: result.staffing.selected_work_cells.map(item => item.work_cell_id), routes: result.routes.map(item => ({task_id: item.task_id, harness: item.chosen_harness, model: item.chosen_model})), harness_switch: result.harness_switch_proof ? {outputs_equal: result.harness_switch_proof.outputs_equal, adapters: result.harness_switch_proof.adapters.length} : null})); }
  if (command === 'p8-run') { const result = await runP8ToolPlane({workspaceRoot: value(args, '--workspace-root', process.cwd()), evidenceRoot: value(args, '--evidence-root'), runtimeRoot: value(args, '--runtime-root'), inputRoot: value(args, '--input'), chromePath: value(args, '--chrome-path', process.env.CHROME_PATH || 'chrome')}); writeJson(value(args, '--output'), result); return console.log(JSON.stringify({status: result.browser.verdict === 'PASS' && result.git.verdict === 'PASS' ? 'PASS' : 'FAIL', run_id: result.run_id, browser: result.browser.verdict, refresh: result.refresh.freshness_summary, git: result.git.verdict, document: result.document.verdict, selected_tools: result.toolPlan.requirements.map(item => ({task_id: item.task_id, tool_id: item.resolution.chosen_tool_id}))})); }
  if (command === 'p8-qa') { const qa = independentP8Qa({p75CandidateRoot: value(args, '--p75-root'), p75SnapshotPath: value(args, '--p75-snapshot'), p8CandidateRoot: value(args, '--p8-root'), p8SnapshotPath: value(args, '--p8-snapshot'), evidenceRoot: value(args, '--evidence-root'), baselinePath: value(args, '--baseline')}); writeJson(value(args, '--output'), qa); return console.log(JSON.stringify({status: qa.verdict, defects: qa.defects.length})); }
  if (command === 'harness-switch') { const result = await runHarnessSwitchProof({fixtureRoot: value(args, '--fixture-root'), outputRoot: value(args, '--output-root')}); return console.log(JSON.stringify({status: result.outputs_equal ? 'PASS' : 'FAIL', outputs_equal: result.outputs_equal, adapters: result.adapters.map(item => item.adapter_id)})); }
  if (command === 'freeze') { const result = freezeCandidate(value(args, '--candidate-root'), value(args, '--output'), {phase: 'P8'}); return console.log(JSON.stringify({status: 'PASS', snapshot_id: result.snapshot_id, entries: result.entries.length})); }
  if (command === 'qa') { const run = readJson(value(args, '--run')); const proof = readJson(value(args, '--proof')); const baseline = readJson(value(args, '--baseline')); const normalizedPath = path.join(run.intake.state_root, 'snapshots', 'MODEL_INTELLIGENCE_NORMALIZED.json'); const runWithNormalized = {...run, normalized: readJson(normalizedPath)}; const qa = independentQa({candidateRoot: value(args, '--candidate-root'), snapshotManifest: readJson(value(args, '--snapshot')), runResult: runWithNormalized, harnessProof: proof, baseline}); writeQa(value(args, '--output'), qa); return console.log(JSON.stringify({status: qa.verdict, defects: qa.defects.length})); }
  throw new Error(`unknown command ${command}`);
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
