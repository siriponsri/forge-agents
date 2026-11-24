import { append, records, record, mutate, find, fail, revision, changed, snapshotSkill, boundedText, digest } from './records.mjs';
import { discover, selectFromState } from './selection.mjs';
import { resolveEvidence, checkEvidence, comparableChecks, validateChecks, EVALUATION_LIMITS } from './evidence.mjs';
import { createLoopMethods, LOOP_LIMITS } from './loop.mjs';
export { EVALUATION_LIMITS };
export { LOOP_LIMITS };

export function createAdaptiveService({store, t3, connections}={}) {
  if (!store?.read || !store?.transaction) throw new TypeError('A durable FORGE store is required');
  const service = {
    async select(input) {
      const prior = store.read().receipts.find(r => r.operationId === input.operationId);
      // mutate validates replay identity even when catalog discovery is unavailable.
      const inventory = prior ? {providers:[]} : await discover(t3);
      return mutate(store, 'select', input, s => append(s, 'decision', selectFromState(s, input, inventory, t3, connections), input.projectId));
    },
    status({projectId, taskId}) {
      const s = store.read(); find(s, 'projects', projectId);
      return {decisions:records(s,'decision',projectId).filter(d => !taskId || d.taskId === taskId),
        candidates:s.skills.filter(x => x.projectId === projectId && x.provenance?.kind === 'adaptive.candidate'),
        evaluations:records(s,'evaluation',projectId), history:records(s,'promotion',projectId),
        loops:records(s,'loop',projectId).filter(l => !taskId || l.taskId === taskId), limits:EVALUATION_LIMITS, loopLimits:LOOP_LIMITS};
    },
    candidate(input) {
      return mutate(store, 'candidate', input, s => {
        const base = find(s,'skills',input.skillId,input.projectId); revision(base,input.expectedRevision);
        if (base.status !== 'active') fail('VALIDATION', 'Improve an active skill version');
        const version = boundedText(input.version,'version',80), instructions = boundedText(input.instructions,'instructions');
        if (version === base.version || instructions === base.instructions) fail('VALIDATION', 'Candidate needs a new version and changed instructions');
        const lineageId = base.provenance?.lineageId ?? base.id;
        if (s.skills.some(x => x.projectId === input.projectId && (x.id === lineageId || x.provenance?.lineageId === lineageId) && x.version === version)) fail('VERSION_EXISTS', 'Version already exists in this skill history', 409);
        const evidence = resolveEvidence(s,input.evidenceRefs,input.projectId);
        const candidate = append(s,'candidate',{name:base.name, version, instructions, requires:structuredClone(base.requires ?? []), status:'candidate',
          evidence, provenance:{kind:'adaptive.candidate',lineageId,parentId:base.id,parentSnapshot:snapshotSkill(base),lesson:boundedText(input.lesson,'lesson',4000),createdFromOperation:input.operationId}},input.projectId);
        // The candidate itself lives in skills; retain a separate immutable draft audit event.
        const skill = {...candidate}; delete skill.type; s.skills.push(skill);
        return skill;
      });
    },
    evaluate(input) {
      return mutate(store,'evaluate',input,async s => {
        const candidate = find(s,'skills',input.candidateId,input.projectId); revision(candidate,input.expectedRevision);
        if (candidate.status !== 'candidate' || !candidate.provenance?.parentSnapshot) fail('VALIDATION','Choose an improvement candidate');
        const checks = validateChecks(input.checks), baselineChecks = validateChecks(input.baselineChecks);
        if (!comparableChecks(baselineChecks,checks)) fail('REGRESSION_CONTRACT','Use matching baseline/candidate check keys and kinds, including artifact or verifier evidence',409);
        const baseline = await checkEvidence(s,input.projectId,baselineChecks,{skill:candidate.provenance.parentSnapshot});
        const result = await checkEvidence(s,input.projectId,checks,{skill:snapshotSkill(candidate)});
        return append(s,'evaluation',{candidateId:candidate.id,candidateSnapshot:snapshotSkill(candidate),baselineSnapshot:candidate.provenance.parentSnapshot,
          checks,baselineChecks,baseline,result,status:baseline.status === 'PASSED' && result.status === 'PASSED' ? 'PASSED' : 'FAILED',
          interpretation:'Evidence checks passed/failed only; does not establish improved model quality or causal skill effectiveness'},input.projectId);
      });
    },
    promote(input) {
      return mutate(store,'promote',input,async s => {
        const candidate=find(s,'skills',input.candidateId,input.projectId);revision(candidate,input.expectedRevision);
        const evaluation=record(s,'evaluation',input.evaluationId,input.projectId);
        if (candidate.status !== 'candidate' || evaluation.status !== 'PASSED' || evaluation.candidateId !== candidate.id || digest(evaluation.candidateSnapshot) !== digest(snapshotSkill(candidate))) fail('EVALUATION_REQUIRED','Passed evaluation for this exact candidate is required',409);
        const parent=find(s,'skills',candidate.provenance.parentId,input.projectId);
        if (parent.status !== 'active' || digest(snapshotSkill(parent)) !== digest(candidate.provenance.parentSnapshot)) fail('REVISION_CONFLICT','Base skill changed after candidate creation',409);
        const baseline=await checkEvidence(s,input.projectId,evaluation.baselineChecks,{skill:evaluation.baselineSnapshot});
        const result=await checkEvidence(s,input.projectId,evaluation.checks,{skill:evaluation.candidateSnapshot});
        if (baseline.status !== 'PASSED' || result.status !== 'PASSED') fail('EVIDENCE_REGRESSION','Evaluation evidence is unavailable or regressed; evaluate again',409,{baseline,result});
        const before={parent:snapshotSkill(parent),candidate:snapshotSkill(candidate)};
        parent.status='retired';changed(parent);candidate.status='active';changed(candidate);
        return append(s,'promotion',{action:'promote',candidateId:candidate.id,parentId:parent.id,evaluationId:evaluation.id,before,
          after:{parent:snapshotSkill(parent),candidate:snapshotSkill(candidate)},reason:boundedText(input.reason,'reason',4000),verification:{baseline,result}},input.projectId);
      });
    },
    rollback(input) {
      return mutate(store,'rollback',input,s => {
        const promotion=record(s,'promotion',input.promotionId,input.projectId);
        if (promotion.action !== 'promote') fail('VALIDATION','Select a promotion to roll back');
        const candidate=find(s,'skills',promotion.candidateId,input.projectId),parent=find(s,'skills',promotion.parentId,input.projectId);
        revision(candidate,input.expectedRevision);
        if (candidate.status !== 'active' || parent.status !== 'retired' || digest(snapshotSkill(candidate)) !== digest(promotion.after.candidate) || digest(snapshotSkill(parent)) !== digest(promotion.after.parent)) fail('REVISION_CONFLICT','Skill lineage changed after this promotion',409);
        candidate.status='retired';changed(candidate);parent.status='active';changed(parent);
        return append(s,'promotion',{action:'rollback',promotionId:promotion.id,candidateId:candidate.id,parentId:parent.id,
          restoredSnapshot:snapshotSkill(parent),reason:boundedText(input.reason,'reason',4000)},input.projectId);
      });
    },
  };
  return Object.assign(service,createLoopMethods({store,t3,connections}));
}
