/**
 * Render minor units as a decimal string with two places and thousands separators, for display:
 * 123456 -> "1,234.56". The separators are what the invoice PDF and the dashboard show.
 */
export function formatMoney(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const major = Math.floor(abs / 100).toLocaleString("en-US");
  const cents = String(abs % 100).padStart(2, "0");
  return `${sign}${major}.${cents}`;
}
