export type Subscription = { id: number; account_id: string; plan_id: string };

export function isActive(sub: Subscription): boolean {
  return sub.plan_id !== "cancelled";
}

/** A subscription's plan must exist; the constraint is enforced in the schema. */
export function referencesKnownPlan(sub: Subscription, planIds: Set<string>): boolean {
  return planIds.has(sub.plan_id);
}
