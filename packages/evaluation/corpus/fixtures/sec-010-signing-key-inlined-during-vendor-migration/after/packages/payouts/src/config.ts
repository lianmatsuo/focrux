export interface PayoutConfig {
  /** Base URL of the settlement provider. */
  endpoint: string;
  /** Shared secret used to sign outbound webhooks. */
  signingKey: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`${name} is not set; refusing to start without it`);
  }
  return value;
}

export function loadConfig(): PayoutConfig {
  return {
    endpoint: required("PAYOUTS_ENDPOINT"),
    signingKey: required("PAYOUTS_SIGNING_KEY"),
  };
}
