// Pure call arithmetic for plan.mjs and the background updater's budget. Tested in tests/plan.test.mjs.
import { RATE_BATCH, RATED_SHARE } from "./rate.mjs";
export const LENS_BATCH = 60;

// perLens: items still missing each lens's answer; unratedKnown: urgent/soon items with a project and
// no rating yet. Items the lenses have not seen are estimated to need rating at RATED_SHARE.
export function planCalls({ perLens, unratedKnown, limit }) {
  const lensCalls = perLens.reduce((s, n) => s + Math.ceil(n / LENS_BATCH), 0);
  const unseen = Math.max(0, ...perLens);
  const toRate = unratedKnown + Math.ceil(unseen * RATED_SHARE);
  const rateCalls = Math.ceil(toRate / RATE_BATCH);
  const calls = lensCalls + rateCalls;
  return { itemsNeedingReview: unseen, itemsToRate: toRate, ratingIsEstimate: unseen > 0, lensCalls, rateCalls, calls, limit, askFirst: calls > limit };
}
