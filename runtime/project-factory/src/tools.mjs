import path from 'node:path';
import {canonicalJson, nowIso, sha256, sortedUnique} from './core.mjs';
import {DEFAULT_TOOL_SIDE_EFFECT_POLICY, TOOL_STATUSES, evaluateToolSideEffect} from './tool-policy.mjs';

export const TOOL_REGISTRY_SCHEMA_VERSION = '1.0.0';
function tool({tool_id, display_name, tool_type, source, exact_version = 'UNKNOWN', provenance, install_scope = 'EXISTING_LOCAL', runtime_location = 'UNKNOWN', capabilities, named_consumers, side_effect_classes_supported, authorization_requirements = [], health_state = 'HEALTHY', availability = true, freshness = 'FRESH', deterministic_probe, evidence_refs = [], known_limitations = [], status = 'AVAILABLE', local_preference = 1, complexity = 1}) {
  return {tool_id, display_name, tool_type, source, exact_version, provenance, install_scope, runtime_location, capabilities, named_consumers, side_effect_classes_supported, authorization_requirements, health_state, availability, freshness, deterministic_probe, evidence_refs, known_limitations, promotion_status: 'CANDIDATE_ONLY', status, local_preference, complexity};
}

export function buildToolRegistry({workspaceRoot = process.cwd(), chromePath = process.env.CHROME_PATH || 'chrome', chromeVersion = '152.0.7977.83', gitVersion = '2.54.0.windows.1', opencodeVersion = '1.18.30', rtkVersion = '0.45.0'} = {}) {
  const root = path.resolve(workspaceRoot); const tools = [
    tool({tool_id:'browser-chrome-cdp',display_name:'Google Chrome Headless CDP',tool_type:'CLI',source:'local-executable',exact_version:chromeVersion,provenance:'LOCAL_FILE_VERSION_OBSERVED',runtime_location:chromePath,capabilities:['browser-automation','ui-qa','dom-inspection','structured-evidence'],named_consumers:['Frontend QA','UI review','future post-deploy verification'],side_effect_classes_supported:['READ_LOCAL','WRITE_PROJECT_LOCAL'],authorization_requirements:['loopback-only','disposable-profile','no-login'],deterministic_probe:'P8_BROWSER_PROBE',evidence_refs:['P8_BROWSER_PROBE.json'],known_limitations:['no authenticated login','no external network dependency'],status:'INTEGRATED',local_preference:10,complexity:2}),
    tool({tool_id:'native-git',display_name:'Native Git',tool_type:'CLI',source:'local-executable',exact_version:gitVersion,provenance:'LOCAL_VERSION_PROBE',runtime_location:'git',capabilities:['git','repo-inspection','local-branch','local-rollback'],named_consumers:['Release workflow','Project Factory local state'],side_effect_classes_supported:['READ_LOCAL','WRITE_PROJECT_LOCAL','DESTRUCTIVE_LOCAL'],authorization_requirements:['disposable-workspace-for-write'],deterministic_probe:'P8_GIT_CAPABILITY_RESULT',evidence_refs:['P8_GIT_CAPABILITY_RESULT.json'],known_limitations:['remote write disabled in P8'],status:'INTEGRATED',local_preference:10}),
    tool({tool_id:'model-intelligence-refresh',display_name:'Project Factory Model Intelligence Refresh',tool_type:'BUILT_IN',source:'candidate-runtime',exact_version:'0.1.0-p8',provenance:'P8_CANDIDATE_SOURCE',runtime_location:path.join(root,'src','model-refresh.mjs'),capabilities:['model-freshness','provider-lineup','pricing-observation','runtime-health'],named_consumers:['Project Factory Route Resolver'],side_effect_classes_supported:['READ_LOCAL','READ_EXTERNAL_PUBLIC'],authorization_requirements:['source-precedence','unknown-safe-fallback'],deterministic_probe:'P8_MODEL_REFRESH_RESULT',evidence_refs:['P8_MODEL_REFRESH_RESULT.json'],known_limitations:['pricing UNKNOWN without safe source'],status:'INTEGRATED',local_preference:10}),
    tool({tool_id:'local-markdown-normalizer',display_name:'Local Markdown Text Normalizer',tool_type:'BUILT_IN',source:'candidate-runtime',exact_version:'0.1.0-p8',provenance:'P8_CANDIDATE_SOURCE',runtime_location:path.join(root,'src','document.mjs'),capabilities:['document-ingestion','markdown-normalization'],named_consumers:['discovery/research intake','docs ingestion'],side_effect_classes_supported:['READ_LOCAL','WRITE_PROJECT_LOCAL'],authorization_requirements:['local-file-only'],deterministic_probe:'P8_DOCUMENT_INGESTION_RESULT',evidence_refs:['P8_DOCUMENT_INGESTION_RESULT.json'],known_limitations:['binary office conversion deferred'],status:'INTEGRATED',local_preference:10}),
    tool({tool_id:'opencode',display_name:'OpenCode CLI',tool_type:'CLI',source:'local-path',exact_version:opencodeVersion,provenance:'LOCAL_VERSION_PROBE',runtime_location:'opencode',capabilities:['harness','model-route','runtime-health'],named_consumers:['Project Factory Route Resolver','Frontend QA'],side_effect_classes_supported:['READ_LOCAL','WRITE_PROJECT_LOCAL'],authorization_requirements:['read-only-default'],deterministic_probe:'P7.5_HARNESS_SWITCH_PROOF',evidence_refs:['P7_5_HARNESS_SWITCH_PROOF.json'],known_limitations:['no paid generation in P8'],status:'INTEGRATED',local_preference:8,complexity:2}),
    tool({tool_id:'rtk',display_name:'RTK',tool_type:'CLI',source:'local-path',exact_version:rtkVersion,provenance:'P4_RUNTIME_REGISTRY',runtime_location:'rtk',capabilities:['terminal-noise-reduction'],named_consumers:['developer terminal ergonomics'],side_effect_classes_supported:['READ_LOCAL'],authorization_requirements:['explicit opt-in'],deterministic_probe:'VERSION_ONLY',evidence_refs:['03-tool-pack/sources.json'],known_limitations:['not required for qualification readiness'],status:'OPTIONAL',local_preference:5}),
    tool({tool_id:'chrome-devtools-mcp',display_name:'Chrome DevTools MCP candidate',tool_type:'MCP',source:'03-tool-pack manifest only',exact_version:'UNPINNED',provenance:'SOURCE_MANIFEST_ONLY',install_scope:'NOT_ACQUIRED',capabilities:['browser-automation','dom-inspection'],named_consumers:['Frontend QA','UI review'],side_effect_classes_supported:['READ_LOCAL','WRITE_PROJECT_LOCAL'],authorization_requirements:['acquisition and audit required'],deterministic_probe:'NOT_RUN',evidence_refs:['03-tool-pack/sources.json','03-tool-pack/AUDIT_MATRIX.md'],known_limitations:['direct Chrome CDP already satisfies contract'],status:'DEFERRED',local_preference:1,complexity:8}),
    tool({tool_id:'markitdown',display_name:'Microsoft MarkItDown candidate',tool_type:'LIBRARY',source:'03-tool-pack manifest only',exact_version:'UNPINNED',provenance:'SOURCE_MANIFEST_ONLY',install_scope:'NOT_ACQUIRED',capabilities:['document-ingestion'],named_consumers:['docs ingestion'],side_effect_classes_supported:['READ_LOCAL','WRITE_PROJECT_LOCAL'],authorization_requirements:['sandbox acquisition required'],deterministic_probe:'NOT_RUN',evidence_refs:['03-tool-pack/sources.json'],known_limitations:['built-in normalizer sufficient for current fixture'],status:'DEFERRED',local_preference:1,complexity:5}),
    tool({tool_id:'markdownify-mcp',display_name:'Markdownify MCP candidate',tool_type:'MCP',source:'03-tool-pack manifest only',exact_version:'UNPINNED',provenance:'SOURCE_MANIFEST_ONLY',install_scope:'NOT_ACQUIRED',capabilities:['document-ingestion'],named_consumers:['docs ingestion'],side_effect_classes_supported:['READ_LOCAL','WRITE_PROJECT_LOCAL'],authorization_requirements:['acquisition and audit required'],deterministic_probe:'NOT_RUN',evidence_refs:['03-tool-pack/sources.json'],known_limitations:['duplicate higher-risk candidate'],status:'REJECTED',local_preference:0,complexity:9}),
    tool({tool_id:'github-pr-write',display_name:'GitHub remote PR/write surface',tool_type:'CONNECTOR',source:'03-tool-pack manifest only',exact_version:'DEFERRED',provenance:'SOURCE_MANIFEST_ONLY',install_scope:'NOT_ACQUIRED',capabilities:['github-remote-write'],named_consumers:['Release workflow'],side_effect_classes_supported:['WRITE_EXTERNAL'],authorization_requirements:['future explicit owner approval'],deterministic_probe:'POLICY_ONLY',evidence_refs:['03-tool-pack/sources.json'],known_limitations:['remote write and PR creation disabled in P8'],status:'DEFERRED',local_preference:0,complexity:10}),
    tool({tool_id:'cloud-deploy',display_name:'Railway/Vercel deployment adapter',tool_type:'CONNECTOR',source:'P7.5 deployment contract',exact_version:'DEFERRED',provenance:'P7.5_CONTRACT_ONLY',install_scope:'NOT_ACQUIRED',capabilities:['cloud-deploy'],named_consumers:['Cloud release'],side_effect_classes_supported:['DEPLOY_EXTERNAL'],authorization_requirements:['future explicit owner approval'],deterministic_probe:'POLICY_ONLY',evidence_refs:['P7_5_PROJECT_FACTORY_ARCHITECTURE.md'],known_limitations:['no authentication or deployment in P8'],status:'DEFERRED',local_preference:0,complexity:10}),
    tool({tool_id:'existing-host-connectors',display_name:'Existing host connector surface',tool_type:'MCP',source:'candidate capability registry',exact_version:'DISCOVERED',provenance:'P4B_CANDIDATE_REGISTRY',install_scope:'EXISTING_CANDIDATE',runtime_location:'candidate/.agent-shared/runtime/capability-registry.json',capabilities:['mcp'],named_consumers:['Project Factory tool plane'],side_effect_classes_supported:['READ_LOCAL'],authorization_requirements:['only-if-callable'],deterministic_probe:'NOT_CALLABLE_PROOFED',evidence_refs:['candidate/.agent-shared/runtime/capability-registry.json'],known_limitations:['discovered but not activated'],status:'DEFERRED',local_preference:1,complexity:6})
  ];
  return {schema_version:TOOL_REGISTRY_SCHEMA_VERSION,registry_id:`TOOLREG-${sha256(canonicalJson(tools.map(item=>item.tool_id))).slice(0,12)}`,authority:'P8_CANDIDATE_ONLY',generated_at:nowIso(),default_side_effect_policy:DEFAULT_TOOL_SIDE_EFFECT_POLICY.policy_id,tools};
}

export function validateToolRegistry(registry) {
  if (registry?.schema_version !== TOOL_REGISTRY_SCHEMA_VERSION) throw new Error('TOOL_REGISTRY_SCHEMA_VERSION');
  if (!Array.isArray(registry.tools) || registry.tools.length === 0) throw new Error('TOOL_REGISTRY_TOOLS_REQUIRED');
  const ids = new Set();
  for (const item of registry.tools) {
    if (!item.tool_id || ids.has(item.tool_id)) throw new Error(`TOOL_REGISTRY_DUPLICATE:${item.tool_id}`); ids.add(item.tool_id);
    if (!TOOL_STATUSES.includes(item.status)) throw new Error(`TOOL_REGISTRY_STATUS:${item.tool_id}`);
    if (!Array.isArray(item.capabilities) || !Array.isArray(item.named_consumers) || item.named_consumers.length === 0) throw new Error(`TOOL_REGISTRY_CONSUMER:${item.tool_id}`);
    if (item.promotion_status !== 'CANDIDATE_ONLY') throw new Error(`TOOL_REGISTRY_PROMOTION:${item.tool_id}`);
  }
  return true;
}

function score(item) { return (item.status === 'INTEGRATED' ? 200 : item.status === 'HEALTHY' ? 150 : 0) + (item.health_state === 'HEALTHY' ? 100 : 0) + (item.local_preference ?? 0) * 10 - (item.complexity ?? 0); }

export function resolveTool({registry, capability, named_consumer, side_effect_class = 'READ_LOCAL', authorization = {}, project_root, action_path, requireFresh = false, external_writes = false} = {}) {
  validateToolRegistry(registry); const accepted = new Set(['AVAILABLE', 'HEALTHY', 'INTEGRATED']);
  const evaluated = registry.tools.map(item => {
    const reasons = [];
    if (!item.capabilities.includes(capability)) reasons.push('CAPABILITY_MISMATCH');
    if (!item.named_consumers.includes(named_consumer)) reasons.push('NAMED_CONSUMER_MISMATCH');
    if (!accepted.has(item.status)) reasons.push(`STATUS_${item.status}`);
    if (item.health_state !== 'HEALTHY') reasons.push('UNHEALTHY');
    if (item.availability !== true) reasons.push('UNAVAILABLE');
    if (requireFresh && item.freshness !== 'FRESH') reasons.push('FRESHNESS_UNSUITABLE');
    if (item.install_scope === 'NOT_ACQUIRED' || item.provenance === 'SOURCE_MANIFEST_ONLY') reasons.push('NOT_ACQUIRED');
    const policy = evaluateToolSideEffect({side_effect_class, authorization, project_root, action_path, external_writes}); reasons.push(...policy.reasons);
    return {tool:item, ok:reasons.length === 0, reasons:sortedUnique(reasons), score:score(item)};
  });
  const eligible = evaluated.filter(item => item.ok).sort((a,b) => b.score - a.score || a.tool.tool_id.localeCompare(b.tool.tool_id)); const chosen = eligible[0] ?? null;
  return {schema_version:'1.0.0',resolution_id:`TOOLROUTE-${sha256(canonicalJson({capability,named_consumer,side_effect_class,eligible:eligible.map(item=>item.tool.tool_id)})).slice(0,12)}`,capability,named_consumer,side_effect_class,authorization,chosen_tool_id:chosen?.tool.tool_id ?? null,chosen_tool_version:chosen?.tool.exact_version ?? null,eligible_tools:eligible.map(item=>({tool_id:item.tool.tool_id,score:item.score})),rejected_tools:evaluated.filter(item=>!item.ok).map(item=>({tool_id:item.tool.tool_id,reasons:item.reasons})),deterministic:true,frozen:true,external_writes:false,production_tool_mutation:false};
}

export function buildToolPlan({registry, project_root} = {}) {
  const requirements = [
    {task_id:'repo-inspection',capability:'repo-inspection',named_consumer:'Release workflow',side_effect_class:'READ_LOCAL',authorization:{}},
    {task_id:'local-project-writes',capability:'git',named_consumer:'Release workflow',side_effect_class:'WRITE_PROJECT_LOCAL',authorization:{disposable_workspace:true,project_local_write:true},action_path:path.join(project_root ?? process.cwd(),'disposable')},
    {task_id:'frontend-browser-qa',capability:'browser-automation',named_consumer:'Frontend QA',side_effect_class:'WRITE_PROJECT_LOCAL',authorization:{disposable_workspace:true,project_local_write:true},action_path:path.join(project_root ?? process.cwd(),'browser')},
    {task_id:'model-freshness',capability:'model-freshness',named_consumer:'Project Factory Route Resolver',side_effect_class:'READ_LOCAL',authorization:{}},
    {task_id:'docs-ingestion',capability:'document-ingestion',named_consumer:'docs ingestion',side_effect_class:'READ_LOCAL',authorization:{}},
    {task_id:'github-remote-write-policy',capability:'github-remote-write',named_consumer:'Release workflow',side_effect_class:'WRITE_EXTERNAL',authorization:{},external_writes:true}
  ];
  const resolutions = requirements.map(item => ({...item,resolution:resolveTool({registry,project_root,...item})}));
  return {schema_version:'1.0.0',plan_id:`TOOLPLAN-${sha256(canonicalJson(resolutions.map(item=>[item.task_id,item.resolution.chosen_tool_id]))).slice(0,12)}`,created_at:nowIso(),frozen:true,requirements:resolutions,production_tool_mutation:false};
}
