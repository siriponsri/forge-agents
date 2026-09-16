import fs from 'node:fs';
import path from 'node:path';
import {assert, EVIDENCE_CLASSES, nowIso, normalizeId, parseFreshness, readJson, sha256, sortedUnique} from './core.mjs';

const REQUIRED_INPUTS = ['MODEL_REGISTRY.json', 'PROVIDER_REGISTRY.json', 'TASK_TAXONOMY.json', 'MODEL_EVIDENCE.jsonl', 'SOURCE_MANIFEST.json', 'VALIDATION.json'];

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch (error) { throw new Error(`MODEL_INTELLIGENCE_INVALID_JSONL:${index + 1}:${error.message}`); }
  });
}

function validateInputFiles(inputRoot) {
  for (const name of REQUIRED_INPUTS) assert(fs.existsSync(path.join(inputRoot, name)), `missing Model Intelligence input ${name}`);
  const modelRegistry = readJson(path.join(inputRoot, 'MODEL_REGISTRY.json'));
  const providerRegistry = readJson(path.join(inputRoot, 'PROVIDER_REGISTRY.json'));
  const taxonomy = readJson(path.join(inputRoot, 'TASK_TAXONOMY.json'));
  const sourceManifest = readJson(path.join(inputRoot, 'SOURCE_MANIFEST.json'));
  const validation = readJson(path.join(inputRoot, 'VALIDATION.json'));
  const evidence = readJsonl(path.join(inputRoot, 'MODEL_EVIDENCE.jsonl'));
  assert(Array.isArray(modelRegistry.models), 'MODEL_REGISTRY.models must be an array');
  assert(modelRegistry.model_count === modelRegistry.models.length, 'MODEL_REGISTRY.model_count mismatch');
  assert(Array.isArray(providerRegistry.providers), 'PROVIDER_REGISTRY.providers must be an array');
  assert(Array.isArray(taxonomy.tasks), 'TASK_TAXONOMY.tasks must be an array');
  for (const item of modelRegistry.models) {
    assert(typeof item.canonical_model_name === 'string' && item.canonical_model_name.trim(), 'model canonical_model_name required');
    assert(Array.isArray(item.provider_surfaces), `provider_surfaces required for ${item.canonical_model_name}`);
  }
  for (const item of providerRegistry.providers) assert(typeof item.provider === 'string' && item.provider.trim(), 'provider name required');
  for (const item of evidence) {
    for (const field of ['evidence_id', 'model', 'evidence_class', 'observed_at', 'freshness_window']) assert(field in item, `evidence field ${field} required`);
    assert(EVIDENCE_CLASSES.includes(item.evidence_class), `unsupported evidence class ${item.evidence_class}`);
  }
  return {modelRegistry, providerRegistry, taxonomy, sourceManifest, validation, evidence};
}

function aliasIndex(models) {
  const aliases = new Map();
  const add = (alias, modelKey) => {
    const key = normalizeId(alias);
    if (!aliases.has(key)) aliases.set(key, []);
    aliases.get(key).push(modelKey);
  };
  for (const model of models) {
    const modelKey = normalizeId(model.canonical_model_name);
    add(model.canonical_model_name, modelKey);
    for (const surface of model.provider_surfaces) if (surface.model_id) add(surface.model_id, modelKey);
  }
  return Object.fromEntries([...aliases.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([alias, values]) => [alias, sortedUnique(values)]));
}

function normalizeModel(model, evidence, at) {
  const modelKey = normalizeId(model.canonical_model_name);
  const surfaces = model.provider_surfaces.map(surface => ({
    provider_id: normalizeId(surface.provider),
    provider: surface.provider ?? 'UNKNOWN',
    model_id: surface.model_id ?? 'UNKNOWN',
    route_id: surface.route_id ?? 'UNKNOWN',
    availability: surface.availability ?? 'UNKNOWN',
    observed_at: surface.observed_at ?? 'UNKNOWN',
    freshness_window: surface.freshness_window ?? 'UNKNOWN',
    freshness: parseFreshness(surface.observed_at, surface.freshness_window, at),
    source: surface.source ?? 'UNKNOWN',
    source_record: surface
  }));
  const modelEvidence = evidence.filter(item => normalizeId(item.model) === modelKey).map(item => ({...item, freshness: parseFreshness(item.observed_at, item.freshness_window, at)}));
  const capabilityFields = ['modalities', 'context_window_tokens', 'max_output_tokens', 'tool_function_calling', 'structured_output', 'vision_image_support', 'coding_suitability', 'agentic_workflow_suitability'];
  const unknownFields = capabilityFields.filter(field => {
    const rawValue = JSON.stringify(model[field]);
    return rawValue === '"UNKNOWN"' || (typeof rawValue === 'string' && rawValue.includes('"UNKNOWN"'));
  });
  return {
    model_key: modelKey,
    canonical_model_name: model.canonical_model_name,
    vendor: model.vendor ?? 'UNKNOWN',
    provider_surfaces: surfaces,
    capability_fields: Object.fromEntries(capabilityFields.map(field => [field, field in model ? model[field] : 'UNKNOWN'])),
    evidence_refs: modelEvidence.map(item => item.evidence_id),
    evidence_classes: sortedUnique(modelEvidence.map(item => item.evidence_class)),
    unknown_fields: unknownFields,
    task_affinity: model.task_affinity ?? 'UNKNOWN',
    source_ids: model.source_ids ?? [],
    source_urls: model.source_urls ?? [],
    source_record: model
  };
}

export function normalizeModelIntelligence(inputRoot, {at = new Date()} = {}) {
  const resolved = path.resolve(inputRoot);
  const raw = validateInputFiles(resolved);
  const models = raw.modelRegistry.models.map(model => normalizeModel(model, raw.evidence, at));
  const providers = raw.providerRegistry.providers.map(provider => ({
    provider_id: normalizeId(provider.provider),
    provider: provider.provider,
    freshness: parseFreshness(raw.providerRegistry.generated_at, provider.freshness_window, at),
    source_record: provider
  }));
  const aliases = aliasIndex(raw.modelRegistry.models);
  const duplicateAliases = Object.fromEntries(Object.entries(aliases).filter(([, values]) => values.length > 1));
  const freshnessSummary = {FRESH: 0, STALE: 0, UNKNOWN: 0};
  for (const model of models) for (const surface of model.provider_surfaces) freshnessSummary[surface.freshness] += 1;
  return {
    schema_version: '1.0.0',
    source_kind: 'RESEARCH_INPUT_CANDIDATE',
    source_root: resolved,
    source_pack_version: raw.modelRegistry.pack_version ?? 'UNKNOWN',
    normalized_at: nowIso(),
    source_generated_at: raw.modelRegistry.generated_at ?? 'UNKNOWN',
    counts: {models: models.length, providers: providers.length, evidence: raw.evidence.length, taxonomy_tasks: raw.taxonomy.tasks.length},
    models,
    providers,
    taxonomy: raw.taxonomy.tasks.map(task => ({task_id: task.task_id, required_signal_dimensions: task.required_signal_dimensions, evidence_classes: task.allowed_evidence_classes})),
    evidence: raw.evidence,
    source_manifest: raw.sourceManifest,
    aliases,
    duplicate_aliases: duplicateAliases,
    freshness_summary: freshnessSummary,
    validation_input: raw.validation,
    normalization_rules: ['UNKNOWN preserved; no inferred capability', 'provider/model IDs normalized for lookup only', 'dynamic observations receive FRESH/STALE/UNKNOWN', 'source_record retained for audit', 'recommendations remain separate from facts']
  };
}

export function validateNormalizedIntelligence(value) {
  assert(value?.schema_version === '1.0.0', 'normalized schema_version');
  assert(value?.source_kind === 'RESEARCH_INPUT_CANDIDATE', 'normalized source_kind');
  assert(Array.isArray(value.models) && Array.isArray(value.providers) && Array.isArray(value.evidence), 'normalized arrays');
  for (const model of value.models) {
    assert(model.model_key && model.canonical_model_name, 'normalized model identity');
    for (const surface of model.provider_surfaces) assert(['FRESH', 'STALE', 'UNKNOWN'].includes(surface.freshness), 'normalized freshness');
  }
  for (const item of value.evidence) assert(EVIDENCE_CLASSES.includes(item.evidence_class), 'normalized evidence class');
  return true;
}
