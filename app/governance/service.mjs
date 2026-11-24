import { createPolicyMethods } from './policy.mjs';
import { createContextMethods } from './context.mjs';
import { reviewProjection } from './review.mjs';
export { validateProjectContext } from './context.mjs';

/** Supplemental governance around FORGE identities; never an execution owner. */
export function createGovernanceService({ store }) {
  if (!store?.read || !store?.transaction) throw new TypeError('A FORGE transactional store is required');
  return {
    ...createPolicyMethods({ store }), ...createContextMethods({ store }),
    reviewInbox(input) { return reviewProjection(store.read(), input); },
  };
}
