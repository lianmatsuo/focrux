export type Subscription = { id: number; account_id: string; plan_id: string };

export function isActive(sub: Subscription): boolean {
  return sub.plan_id !== "cancelled";
}
