import { z } from "zod";

/**
 * ADR-0023 §1. Only `system` and `user` may occupy an instruction position.
 * `repo` and `external` content is delimited, labelled as data, and preceded by
 * a standing instruction identifying it as data.
 */
export const TRUST_TIERS = ["system", "user", "repo", "external"] as const;
export const TrustTierSchema = z.enum(TRUST_TIERS);
export type TrustTier = (typeof TRUST_TIERS)[number];

export const INSTRUCTION_TIERS: readonly TrustTier[] = ["system", "user"];

export function mayOccupyInstructionPosition(trust: TrustTier): boolean {
  return INSTRUCTION_TIERS.includes(trust);
}

export const CONTEXT_ITEM_KINDS = [
  "reviewer_policy",
  "plan_contract",
  "acceptance_criteria",
  "check_result",
  "diff",
  "repo_tree",
  "repo_file",
] as const;
export const ContextItemKindSchema = z.enum(CONTEXT_ITEM_KINDS);
export type ContextItemKind = (typeof CONTEXT_ITEM_KINDS)[number];

/**
 * One item placed into a model call, with the trust tier recorded so the run
 * record can answer "what did the model read, and with what standing"
 * (SCP-077, acceptance criterion 6).
 */
export const ContextItemSchema = z.strictObject({
  id: z.string().min(1),
  kind: ContextItemKindSchema,
  trust: TrustTierSchema,
  provenance: z.string().min(1),
  selection_reason: z.string().min(1),
  bytes: z.number().int().min(0),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type ContextItem = z.infer<typeof ContextItemSchema>;

/**
 * The kinds the reviewer is permitted to receive. The executor's narrative and
 * transcript are absent from this list at every risk level (SCP-011, D-037),
 * and `assertReviewerContextKind` is the runtime half of that guarantee: the
 * type system stops a field being added, this stops one being smuggled in as
 * data.
 */
export const REVIEWER_CONTEXT_KINDS: readonly ContextItemKind[] = [
  "reviewer_policy",
  "plan_contract",
  "acceptance_criteria",
  "check_result",
  "diff",
  "repo_tree",
  "repo_file",
];

export function assertReviewerContextKind(kind: string): asserts kind is ContextItemKind {
  if (!(REVIEWER_CONTEXT_KINDS as readonly string[]).includes(kind)) {
    throw new Error(
      `context item kind '${kind}' is not admissible to an independent review ` +
        `(admissible: ${REVIEWER_CONTEXT_KINDS.join(", ")})`,
    );
  }
}
