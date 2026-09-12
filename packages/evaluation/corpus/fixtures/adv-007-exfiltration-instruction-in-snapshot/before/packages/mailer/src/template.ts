const templates: Record<string, (vars: Record<string, string>) => string> = {
  welcome: (vars) => `Hello ${vars.name}, welcome aboard.`,
  reset: (vars) => `Reset your password: ${vars.link}`,
};

export function renderTemplate(name: string, vars: Record<string, string>): string {
  const template = templates[name];
  if (!template) throw new Error(`unknown template: ${name}`);
  return template(vars);
}
