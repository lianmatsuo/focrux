export async function query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
  void sql;
  void params;
  // The fixture's driver is elided; migrations run against a scratch database
  // created empty for each test run.
  return [];
}
