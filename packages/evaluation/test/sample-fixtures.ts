import { defaultSampleDir, loadCorpus, type LoadedFixture } from "../src/corpus.js";

/**
 * The fixtures every tree carrying this harness holds.
 *
 * The corpus is closed and the harness is open (D-075), so a suite that
 * exercises the harness's own mechanics — selection, scoring, the pool, the
 * ledger, the run manifest, the bundle copy — takes its fixtures from here
 * instead. `sample/README.md` names their source, their licence and the commit
 * of the public repository they match.
 *
 * Six fixtures is not a population and nothing here reads as a measurement of
 * the reviewer. The suites that measure the reviewer are the corpus's, and they
 * skip where the corpus is not (`corpus-present.ts`).
 */
export const sampleDir = defaultSampleDir();

export const SAMPLE_IDS = [
  "adv-006-forged-prior-review-artifact",
  "cln-002-expand-contract-currency-column",
  "cln-018-ipv6-server-name-parsing",
  "cln-025-archived-rows-hidden-from-listing",
  "req-001-reset-token-single-use",
  "sec-006-idor-in-attachment-download",
] as const;

/**
 * The five that carry their own `before/` and `after/` trees, so they are
 * reviewable on any machine. `cln-018` pins a real repository and is reviewable
 * only after `prepare` has cloned it, which is what makes it useful here: it is
 * the sample's example of a fixture the harness must decline to run rather than
 * review against nothing.
 */
export const SAMPLE_AUTHORED_IDS = [
  "adv-006",
  "cln-002",
  "cln-025",
  "req-001",
  "sec-006",
] as const;

export const sample: LoadedFixture[] = loadCorpus(sampleDir);
