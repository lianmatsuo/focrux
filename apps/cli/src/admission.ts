import { z } from "zod";

/**
 * The admission record as a stored ticket actually carries it.
 *
 * Every field is optional and nullable, and unknown keys survive: a ticket file
 * outlives the version that wrote it, and a record from before a measurement
 * existed — or one written by a later version that measures more — must read
 * back as *unrecorded* rather than take the whole ticket down or be quietly
 * trimmed to this version's idea of the record. `TicketSchema` stays strict;
 * this is the reading side of a diagnostic, not a second opinion about what
 * `admit` is allowed to write.
 *
 * Its own module, importing nothing of ours: `tickets.js` parses it and
 * `inspect.js` renders it.
 */
export const StoredAdmissionSchema = z.looseObject({
  elapsed_ms: z.number().int().min(0).nullable().optional(),
  // A string, not the contract's enum: a value this binary does not know is
  // still a record, and the reader shows it as written rather than refusing
  // the ticket. `TicketSchema` keeps the closed list on the writing side.
  criteria_source: z.string().min(1).nullable().optional(),
  criteria_count: z.number().int().min(0).nullable().optional(),
  drafted_at: z.string().min(1).nullable().optional(),
  human_elapsed_ms: z.number().int().min(0).nullable().optional(),
  edit_count: z.number().int().min(0).nullable().optional(),
  level_source: z.string().min(1).nullable().optional(),
  derived_level: z.string().min(1).nullable().optional(),
});
export type StoredAdmission = z.infer<typeof StoredAdmissionSchema>;
