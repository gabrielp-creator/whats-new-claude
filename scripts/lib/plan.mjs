// Pure call arithmetic for plan.mjs and the background updater's budget. Tested in tests/plan.test.mjs.
import { RATE_BATCH, RATED_SHARE } from "./rate.mjs";
export const LENS_BATCH = 60;

// A count is a number, or {first, fyi} when first-party and FYI-only items are batched apart (B-66).
const total = (n) => (typeof n === "number" ? n : (n?.first || 0) + (n?.fyi || 0));
const batches = (n, size) => (typeof n === "number" ? Math.ceil(n / size) : Math.ceil((n?.first || 0) / size) + Math.ceil((n?.fyi || 0) / size));

// perLens: items still missing each lens's answer; unratedKnown: urgent/soon items with a project and
// no rating yet. Items the lenses have not seen are estimated to need rating at RATED_SHARE. Re-runs
// after an injection flag (batch.mjs) are not predicted: they count against the same call cap.
// toRedo: of unratedKnown, the items rated before (B-65, P-20): counted apart, asked about in one question.
export function planCalls({ perLens, unratedKnown, toRedo = 0, limit }) {
  const lensCalls = perLens.reduce((s, n) => s + batches(n, LENS_BATCH), 0);
  const unseen = Math.max(0, ...perLens.map(total));
  const estimate = Math.ceil(unseen * RATED_SHARE);
  const toRate = total(unratedKnown) + estimate;
  const rateCalls = typeof unratedKnown === "number"
    ? Math.ceil(toRate / RATE_BATCH)
    : batches({ first: (unratedKnown?.first || 0) + estimate, fyi: unratedKnown?.fyi || 0 }, RATE_BATCH);
  const calls = lensCalls + rateCalls;
  return { itemsNeedingReview: unseen, itemsToRate: toRate, itemsToRedo: toRedo, ratingIsEstimate: unseen > 0, lensCalls, rateCalls, calls, limit, askFirst: calls > limit };
}
