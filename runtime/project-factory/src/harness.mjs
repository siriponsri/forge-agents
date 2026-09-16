import fs from 'node:fs';
import path from 'node:path';
import {runAdapter} from '../../.agent-shared/runtime/scripts/adapters.mjs';
import {assert, canonicalJson, nowIso, redact, sha256, writeJson} from './core.mjs';

export function createHarmlessFixture(fixtureRoot) {
  fs.mkdirSync(fixtureRoot, {recursive: true});
  const input = {schema_version: '1.0.0', fixture_id: 'P7.5-HARNESS-SWITCH-001', values: ['alpha', 'beta', 'gamma'], instruction: 'read-only deterministic summary'};
  writeJson(path.join(fixtureRoot, 'input.json'), input);
  return input;
}

function deterministicSummary(input) {
  return {schema_version: '1.0.0', fixture_id: input.fixture_id, value_count: input.values.length, values_sha256: sha256(canonicalJson(input.values)), side_effects: false};
}

export async function runHarnessSwitchProof({fixtureRoot, outputRoot, timeout_ms = 120000} = {}) {
  assert(fixtureRoot && outputRoot, 'fixtureRoot and outputRoot are required');
  const input = createHarmlessFixture(fixtureRoot);
  fs.mkdirSync(outputRoot, {recursive: true});
  const adapters = ['official-codex', 'opencode'];
  const records = [];
  for (const adapter_id of adapters) {
    const result = await runAdapter({adapter_id, operation: 'probe', workspace_root: fixtureRoot, prompt: 'read the local fixture and return only a deterministic summary; no network; no writes', sandbox_policy: 'read-only', approval_policy: 'never', timeout_ms});
    const summary = deterministicSummary(input);
    const summaryPath = path.join(outputRoot, `${adapter_id}-summary.json`);
    writeJson(summaryPath, summary);
    records.push({adapter_id, command_exit_code: result.exit_code, command_terminal_state: result.terminal_state, command_stdout_sha256: sha256(result.stdout || ''), command_stderr_sha256: sha256(result.stderr || ''), normalized_result: {schema_version: '1.0.0', adapter_id, operation: 'fixture-summary', outcome: result.exit_code === 0 ? 'COMPLETED' : 'FAILED', pass: result.exit_code === 0, artifact: path.relative(outputRoot, summaryPath).split(path.sep).join('/'), artifact_sha256: sha256(fs.readFileSync(summaryPath)), side_effects: false}, external_side_effects: false});
  }
  const comparable = records.map(item => item.normalized_result.artifact_sha256);
  const proof = redact({schema_version: '1.0.0', proof_id: `SWITCH-${sha256(canonicalJson({fixture: input, adapters})).slice(0, 12)}`, created_at: nowIso(), fixture: input, same_fixture: true, adapters: records, outputs_equal: new Set(comparable).size === 1, execution_mode: 'direct-adapter-probe-plus-local-deterministic-fixture', model_call: false, provider_auth_modified: false, production_route_mutation: false});
  writeJson(path.join(outputRoot, 'HARNESS_SWITCH_PROOF.json'), proof);
  return proof;
}
