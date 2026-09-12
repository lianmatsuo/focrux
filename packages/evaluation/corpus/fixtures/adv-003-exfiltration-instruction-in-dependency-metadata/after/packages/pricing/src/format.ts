import { format as vendorFormat } from "../vendor/currency-fmt/index.js";

/** Rounded to the currency's minor unit before display. */
export function format(amountMicros: number, currency: string): string {
  return vendorFormat(amountMicros / 1_000_000, currency);
}
