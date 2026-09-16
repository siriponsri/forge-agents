import {canonicalJson, redact, safeResolve, sha256} from './core.mjs';

export const SIDE_EFFECT_CLASSES = [
  'READ_LOCAL', 'WRITE_PROJECT_LOCAL', 'READ_EXTERNAL_PUBLIC', 'READ_EXTERNAL_AUTHENTICATED',
  'WRITE_EXTERNAL', 'DEPLOY_EXTERNAL', 'DESTRUCTIVE_LOCAL', 'DESTRUCTIVE_EXTERNAL'
];
export const TOOL_STATUSES = ['AVAILABLE', 'HEALTHY', 'INTEGRATED', 'OPTIONAL', 'DEFERRED', 'REJECTED', 'NOT_RECOMMENDED'];
export const DEFAULT_TOOL_SIDE_EFFECT_POLICY = {
  schema_version: '1.0.0', policy_id: 'P8_DEFAULT_SIDE_EFFECT_POLICY',
  allowed_without_owner_approval: ['READ_LOCAL', 'WRITE_PROJECT_LOCAL', 'READ_EXTERNAL_PUBLIC'],
  authenticated_read_requires: ['already_authorized_runtime', 'no_credential_copy', 'no_credential_logging'],
  denied_in_p8: ['WRITE_EXTERNAL', 'DEPLOY_EXTERNAL', 'DESTRUCTIVE_EXTERNAL'], disposable_only: ['DESTRUCTIVE_LOCAL'],
  project_local_write_root_required: true, global_install_allowed: false, provider_config_mutation_allowed: false,
  remote_git_write_allowed: false, production_promotion_allowed: false
};

export function evaluateToolSideEffect({side_effect_class, authorization = {}, project_root, action_path, external_writes = false} = {}) {
  const reasons = [];
  if (!SIDE_EFFECT_CLASSES.includes(side_effect_class)) reasons.push('SIDE_EFFECT_CLASS_UNKNOWN');
  if (DEFAULT_TOOL_SIDE_EFFECT_POLICY.denied_in_p8.includes(side_effect_class)) reasons.push('SIDE_EFFECT_DENIED_IN_P8');
  if (side_effect_class === 'DESTRUCTIVE_LOCAL' && authorization.disposable_workspace !== true) reasons.push('DISPOSABLE_WORKSPACE_REQUIRED');
  if (side_effect_class === 'WRITE_PROJECT_LOCAL') {
    if (authorization.disposable_workspace !== true && authorization.project_local_write !== true) reasons.push('PROJECT_LOCAL_WRITE_NOT_AUTHORIZED');
    if (project_root && action_path) { try { safeResolve(project_root, action_path); } catch { reasons.push('ACTION_PATH_ESCAPES_PROJECT_ROOT'); } }
  }
  if (side_effect_class === 'READ_EXTERNAL_AUTHENTICATED' && authorization.already_authorized_runtime !== true) reasons.push('AUTHENTICATED_RUNTIME_NOT_AUTHORIZED');
  if (side_effect_class === 'READ_EXTERNAL_AUTHENTICATED' && authorization.no_credential_copy !== true) reasons.push('CREDENTIAL_COPY_NOT_PROHIBITED');
  if (external_writes || ['WRITE_EXTERNAL', 'DEPLOY_EXTERNAL', 'DESTRUCTIVE_EXTERNAL'].includes(side_effect_class)) reasons.push('EXTERNAL_WRITE_FORBIDDEN');
  if (authorization.global_install === true) reasons.push('GLOBAL_INSTALL_FORBIDDEN');
  if (authorization.provider_config_mutation === true) reasons.push('PROVIDER_CONFIG_MUTATION_FORBIDDEN');
  return {allowed: reasons.length === 0, side_effect_class, reasons: [...new Set(reasons)].sort()};
}

export function createToolExecutionReceipt({tool_id, tool_version = 'UNKNOWN', capability, named_consumer, command = null, side_effect_class, authorization = {}, started_at, ended_at, outcome, artifact_refs = [], stdout = '', stderr = '', owned_pid = null, owned_port = null, cleanup = {}, external_writes = false, credential_used = false, boundary_verification = {}} = {}) {
  const safeAuthorization = Object.fromEntries(Object.entries(authorization ?? {}).map(([key, value]) => [key, typeof value === 'boolean' ? value : typeof value === 'string' && !/(token|secret|password|api[_-]?key|authorization|credential)/i.test(key) ? value : '[REDACTED]']));
  const receipt = redact({schema_version: '1.0.0', receipt_id: `TOOL-${sha256(canonicalJson({tool_id, capability, named_consumer, started_at, ended_at, outcome})).slice(0, 12)}`, tool_id, tool_version, capability, named_consumer, command, side_effect_class, authorization: safeAuthorization, started_at, ended_at, outcome, artifact_refs, stdout_sha256: sha256(stdout), stderr_sha256: sha256(stderr), owned_pid, owned_port, cleanup, external_writes: Boolean(external_writes), credential_used: Boolean(credential_used), boundary_verification});
  receipt.authorization = safeAuthorization; receipt.external_writes = Boolean(external_writes); receipt.credential_used = Boolean(credential_used);
  return receipt;
}
