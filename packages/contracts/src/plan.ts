import { z } from "zod";
import {
  CommitShaSchema,
  ContextManifestHashSchema,
  CriterionIdSchema,
  PlanIdSchema,
  RepositoryIdSchema,
  TicketIdSchema,
} from "./ids.js";

/**
 * The plan contract (docs/04, docs/14, ADR-0016, SCP-009).
 *
 * The P1 body is exactly `outcome`, `acceptance_criteria`, `scope` and `base`.
 * Every object here is strict, which is what makes `steps`, `alternatives`,
 * `assumptions` and `problem_statement` *unrepresentable* rather than
 * discouraged — a soft rule would not survive contact with a model that likes
 * writing prose.
 */

export const PLAN_LEVELS = ["P0", "P1", "P2", "P3"] as const;
export const PlanLevelSchema = z.enum(PLAN_LEVELS);
export type PlanLevel = (typeof PLAN_LEVELS)[number];

export const VERIFICATION_KINDS = ["test", "query", "metric", "artifact", "manual"] as const;
export const VerificationKindSchema = z.enum(VERIFICATION_KINDS);
export type VerificationKind = (typeof VERIFICATION_KINDS)[number];

/**
 * What must be PROVEN — never where the proof will live. At approval the test
 * usually does not exist, so a selector here produces invented paths. The
 * binding to real evidence is `CriterionEvidenceBinding`, produced by review.
 */
export const ExpectedVerificationSchema = z
  .strictObject({
    kind: VerificationKindSchema,
    assertion: z.string().min(1),
    // `manual` alone carries these two, because a criterion nobody can
    // automate needs a name against it and a reason it is not automatable.
    manual_reviewer: z.string().min(1).optional(),
    manual_reason: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "manual") {
      if (value.manual_reviewer === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["manual_reviewer"],
          message: "expected_verification.kind 'manual' requires a named reviewer",
        });
      }
      if (value.manual_reason === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["manual_reason"],
          message: "expected_verification.kind 'manual' requires a reason it cannot be automated",
        });
      }
      return;
    }
    if (value.manual_reviewer !== undefined || value.manual_reason !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "manual_reviewer and manual_reason are only valid when kind is 'manual'",
      });
    }
  });
export type ExpectedVerification = z.infer<typeof ExpectedVerificationSchema>;

export const AcceptanceCriterionSchema = z.strictObject({
  id: CriterionIdSchema,
  text: z.string().min(1),
  expected_verification: ExpectedVerificationSchema,
});
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;

const AcceptanceCriteriaSchema = z
  .array(AcceptanceCriterionSchema)
  .min(1)
  .superRefine((criteria, ctx) => {
    const seen = new Set<string>();
    for (const [index, criterion] of criteria.entries()) {
      if (seen.has(criterion.id)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "id"],
          message: `duplicate criterion id ${criterion.id}`,
        });
      }
      seen.add(criterion.id);
    }
  });

export const ScopeSchema = z.strictObject({
  repository_id: RepositoryIdSchema,
  paths_allowed: z.array(z.string().min(1)).min(1),
  paths_prohibited: z.array(z.string().min(1)),
  /** Exempt from scope accounting: lockfiles and codegen would otherwise fire on every change. */
  generated_paths: z.array(z.string().min(1)),
  /**
   * Optional, keyed by a glob over `generated_paths`: the files whose change
   * explains a change to the generated output. A generated file matching a key
   * that changes with **no** declared source in the same diff is a
   * deterministic blocking finding (D-062) — either a hand edit regeneration
   * will erase, or a regeneration nothing in the change accounts for. Paths
   * with no key keep the plain exemption, so declaring nothing changes nothing.
   */
  generated_sources: z.record(z.string().min(1), z.array(z.string().min(1))).optional(),
  expansion_budget_files: z.number().int().min(0),
});
export type Scope = z.infer<typeof ScopeSchema>;

export const BaseSchema = z.strictObject({
  base_commit: CommitShaSchema,
  context_manifest_hash: ContextManifestHashSchema,
  captured_at: z.iso.datetime(),
});
export type PlanBase = z.infer<typeof BaseSchema>;

export const BudgetSchema = z.strictObject({
  max_cost_micros: z.number().int().min(0),
  max_wall_clock_ms: z.number().int().min(0),
});

const identity = {
  plan_id: PlanIdSchema,
  version: z.number().int().positive(),
  ticket_id: TicketIdSchema,
};

/**
 * The four load-bearing fields. Higher levels reuse this object verbatim, so
 * "higher levels add fields additively without changing the P1 shape" is
 * structural rather than a promise (SCP-009).
 */
const p1Body = {
  ...identity,
  outcome: z.string().min(1),
  acceptance_criteria: AcceptanceCriteriaSchema,
  scope: ScopeSchema,
  base: BaseSchema,
};

export const PlanContractP0Schema = z.strictObject({
  ...identity,
  level: z.literal("P0"),
  outcome: z.string().min(1),
  scope: ScopeSchema,
  base: BaseSchema,
  budget: BudgetSchema,
});

export const PlanContractP1Schema = z.strictObject({
  ...p1Body,
  level: z.literal("P1"),
});

const p2Additions = {
  data_impact: z.string().min(1),
  security_impact: z.string().min(1),
  rollout: z.string().min(1),
  rollback: z.string().min(1),
  estimated_recurring_cost_micros: z.number().int().min(0),
};

export const PlanContractP2Schema = z.strictObject({
  ...p1Body,
  level: z.literal("P2"),
  ...p2Additions,
});

export const PlanContractP3Schema = z.strictObject({
  ...p1Body,
  level: z.literal("P3"),
  ...p2Additions,
  decision_record: z.string().min(1),
  named_approver: z.string().min(1),
  alternatives: z.array(z.string().min(1)).min(1),
  contingency: z.string().min(1),
});

export const PlanContractSchema = z.discriminatedUnion("level", [
  PlanContractP0Schema,
  PlanContractP1Schema,
  PlanContractP2Schema,
  PlanContractP3Schema,
]);

export type PlanContract = z.infer<typeof PlanContractSchema>;
export type PlanContractP0 = z.infer<typeof PlanContractP0Schema>;
export type PlanContractWithCriteria = z.infer<
  typeof PlanContractP1Schema | typeof PlanContractP2Schema | typeof PlanContractP3Schema
>;

/** P0 has no acceptance criteria, so independent semantic review is undefined for it. */
export function hasAcceptanceCriteria(
  contract: PlanContract,
): contract is PlanContractWithCriteria {
  return contract.level !== "P0";
}
