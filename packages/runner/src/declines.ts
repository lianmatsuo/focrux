/**
 * The executor's decline protocol (D-065).
 *
 * Under the attempt-as-discriminator rule every routable stopping finding goes
 * to the executor, whose brief names exactly one legitimate way out besides
 * fixing: print, on its own line,
 *
 *   NO_PRACTICE <finding_key>: <reason>
 *
 * declaring that no determinable good practice exists — the finding is a
 * genuine preference a person must decide.
 *
 * The transcript the adapter records is stream-json: one event object per
 * line, with the model's words JSON-escaped inside `assistant` events and the
 * final `result` event. A decline is therefore parsed from the **decoded text
 * of the model's own blocks**, never from raw event lines and never from tool
 * results — repository content echoed through a tool cannot mint a decline —
 * and the marker must be the whole line, so a sentence that merely mentions
 * the protocol does not register. Keys are validated against the routed set;
 * a declined finding skips closure verification, stays open, and reaches the
 * person with the declared reason as data, redacted, never as an instruction.
 */

export interface Decline {
  finding_key: string;
  reason: string;
}

const DECLINE_LINE = /^NO_PRACTICE ([0-9a-f]{64}):\s*(.*)$/;

/** The decoded lines a decline may legitimately appear on. */
function modelTextLines(transcript: readonly string[]): string[] {
  const lines: string[] = [];
  for (const entry of transcript) {
    const trimmed = entry.trim();
    if (trimmed.startsWith("{")) {
      try {
        const event = JSON.parse(trimmed) as {
          type?: string;
          result?: unknown;
          message?: { content?: Array<{ type?: string; text?: unknown }> };
        };
        if (event.type === "assistant" && Array.isArray(event.message?.content)) {
          for (const block of event.message.content) {
            if (block.type === "text" && typeof block.text === "string") {
              lines.push(...block.text.split("\n"));
            }
          }
        } else if (event.type === "result" && typeof event.result === "string") {
          lines.push(...event.result.split("\n"));
        }
        // Any other event — tool results included — is not the model speaking.
        continue;
      } catch {
        // Not JSON after all: fall through and treat it as plain text.
      }
    }
    lines.push(...entry.split("\n"));
  }
  return lines;
}

export function parseDeclines(
  transcript: readonly string[],
  routedKeys: readonly string[],
): Decline[] {
  const routed = new Set(routedKeys);
  const byKey = new Map<string, string>();
  for (const line of modelTextLines(transcript)) {
    const match = DECLINE_LINE.exec(line.trim());
    if (!match) continue;
    const [, finding_key, reason] = match;
    if (!finding_key || !routed.has(finding_key)) continue;
    if (byKey.has(finding_key)) continue;
    byKey.set(finding_key, (reason ?? "").trim());
  }
  return [...byKey.entries()].map(([finding_key, reason]) => ({ finding_key, reason }));
}
