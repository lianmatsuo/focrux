import { z } from "zod";

const EntrySchema = z.object({
  type: z.string().optional(),
  item: z
    .object({
      type: z.string(),
      text: z.string().optional(),
      command: z.string().optional(),
      aggregatedOutput: z.string().optional(),
    })
    .optional(),
  message: z
    .object({
      content: z.array(
        z.object({
          type: z.string(),
          text: z.string().optional(),
          name: z.string().optional(),
        }),
      ),
    })
    .optional(),
  result: z.string().optional(),
});
export interface TranscriptEntry {
  author: string;
  label: string;
  text: string;
}

/** Interpret only documented display fields; provider records never become actions. */
export function retainedOutput(raw: string | null | undefined): {
  entries: TranscriptEntry[];
  terminal: string;
} {
  const entries: TranscriptEntry[] = [],
    commands: string[] = [];
  for (const line of raw?.split("\n") ?? []) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = EntrySchema.safeParse(value);
    if (!parsed.success) continue;
    const entry = parsed.data;
    if (entry.item?.type === "commandExecution")
      commands.push(
        "$ " +
          (entry.item.command ?? "command") +
          "\n" +
          (entry.item.aggregatedOutput ?? "No output retained."),
      );
    if (entry.item?.type === "agentMessage" && entry.item.text)
      entries.push({
        author: "Executor",
        label: "recorded message",
        text: entry.item.text,
      });
    if (entry.type === "assistant")
      for (const block of entry.message?.content ?? []) {
        if (block.type === "text" && block.text)
          entries.push({
            author: "Executor",
            label: "recorded message",
            text: block.text,
          });
        if (block.type === "tool_use" && block.name)
          entries.push({
            author: "Executor",
            label: "tool call",
            text: block.name,
          });
      }
    if (entry.type === "result" && entry.result)
      entries.push({
        author: "Executor",
        label: "recorded result",
        text: entry.result,
      });
  }
  return { entries, terminal: commands.join("\n\n") };
}
