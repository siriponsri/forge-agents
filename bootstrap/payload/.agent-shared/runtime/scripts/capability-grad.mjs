import fs from 'node:fs';
import {canonicalJson, sha256, appendJsonl, nowIso} from './core.mjs';
import {evaluateCandidate} from './resolver.mjs';

export function proposeRoutes(candidates=[], {count=3, ambiguous=true} = {}) {
  if (!Number.isInteger(count) || count < 1) throw new Error('CAPABILITYGRAD_CONTRACT_VIOLATION: count must be positive');
  const ordered = [...candidates].sort((a,b)=>a.id.localeCompare(b.id));
  return ambiguous ? ordered.slice(0, count).map(candidate=>({...candidate, proposal_id:sha256(canonicalJson({id:candidate.id, runtime_id:candidate.runtime_id}))})) : [];
}

export async function safeProbe(route, probeFn) {
  if (route.external_side_effects === true || route.probe_side_effects === true) throw new Error('CAPABILITYGRAD_POLICY_VIOLATION: probe has external side effects');
  if (typeof probeFn !== 'function') throw new Error('CAPABILITYGRAD_CONTRACT_VIOLATION: probeFn is required');
  const started_at = nowIso();
  const result = await probeFn({...route, mode:'harmless-read-only'});
  return {schema_version:'1.0.0', route_id:route.id, started_at, ended_at:nowIso(), outcome:result?.outcome || 'UNKNOWN', pass:result?.pass === true, summary:String(result?.summary || ''), evidence:result?.evidence || [], side_effects:false};
}

export function selectRoute({proposals=[], reports=[], constraints={}} = {}) {
  const byId = Object.fromEntries(reports.map(report=>[report.route_id,report]));
  const assessed = proposals.map(route=>{
    const report = byId[route.id];
    const hard = evaluateCandidate(route, constraints);
    const ok = hard.ok && report?.pass === true;
    return {route, report:report || null, ok, reasons:[...hard.reasons, ...(report ? (report.pass ? [] : ['PROBE_FAILED']) : ['PROBE_MISSING'])]};
  });
  const winner = assessed.filter(item=>item.ok).sort((a,b)=>a.route.id.localeCompare(b.route.id))[0] || null;
  return {schema_version:'1.0.0', selection_id:sha256(canonicalJson({proposals:proposals.map(p=>p.id),reports, constraints})), selected_route:winner?.route.id || null,
    satisfied_hard_constraints:winner ? constraints : {}, rejected:assessed.filter(item=>!item.ok).map(item=>({route_id:item.route.id,reasons:item.reasons})), reports, production_route_mutation:false};
}

export function recordRecommendation(filePath, {proposal, selection, constraints, history=''} = {}) {
  const stableProposal = (proposal || []).map(route=>({id:route.id,runtime_id:route.runtime_id,harness_id:route.harness_id,capabilities:route.capabilities,roles:route.roles,sandbox_policy:route.sandbox_policy,external_side_effects:route.external_side_effects})).sort((a,b)=>a.id.localeCompare(b.id));
  const stableSelection = {selected_route:selection?.selected_route || null,rejected:selection?.rejected || [],satisfied_hard_constraints:selection?.satisfied_hard_constraints || {}};
  const record = {schema_version:'1.0.0', record_id:sha256(canonicalJson({proposal:stableProposal,selection:stableSelection,constraints})), created_at:nowIso(), proposal, selection, constraints, history, production_route_mutation:false};
  if (fs.existsSync(filePath)) {
    const duplicate = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).some(line => { try { return JSON.parse(line).record_id === record.record_id; } catch { return false; } });
    if (duplicate) return record;
  }
  appendJsonl(filePath, record);
  return record;
}
