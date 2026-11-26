import { createHash } from 'node:crypto';
export { entity, find, fail, changed, now, required, revision } from '../server/domain.mjs';
export const digest = value => createHash('sha256').update(JSON.stringify(value)??'undefined').digest('hex');
export const terminal = new Set(['completed','failed','cancelled','interrupted','rolled_back']);
export const busy = run => !terminal.has(run.status);
// Provider failures can contain tokens, URLs, environment dumps or native output.
// Only classified codes cross the public/persistence boundary.
export function safeError(error) {
  const sessionErrors={
    SESSION_ROLE_STALE:'The session role or approved child link changed. Review a new attempt.',
    SESSION_ROLE_STOPPED:'This child prompt was stopped before dispatch. Reconcile the original command.',
    SESSION_ROLE_CONTEXT:'The child prompt differs from its canonical reservation. Inspect the retained command.',
    SESSION_ROLE_PARENT_INACTIVE:'The parent attempt is no longer active. Review a new parent attempt.',
    SESSION_ROLE_OWNER_UNAVAILABLE:'Session-role admission is unavailable. Restart FORGE and reconcile the retained command.',
  };
  if(Object.hasOwn(sessionErrors,error?.code??''))return {code:error.code,message:sessionErrors[error.code]};
  const raw = `${error?.code ?? ''} ${error?.message ?? ''}`;
  const code = /auth|401|403|login|credential/i.test(raw) ? 'AUTH_REQUIRED'
    : /timeout|abort|pending/i.test(raw) ? 'TIMEOUT'
    : /not.found|unknown.tool|unsupported|unavailable|method/i.test(raw) ? 'ROUTE_UNAVAILABLE' : 'PROVIDER_ERROR';
  return {code,message:{AUTH_REQUIRED:'Sign in to this FORGE provider instance and check account access.',TIMEOUT:'Outcome not confirmed. Reconcile before retrying a change.',ROUTE_UNAVAILABLE:'This operation is unavailable in the selected runtime.',PROVIDER_ERROR:'Provider operation failed. Check the selected instance in local T3 settings.'}[code]};
}
export const source = {runtime:'t3',version:'0.1.11',revision:'59651c1761f6c63e9b6056839067066968e6a406'};
