import {
  DraftSchema,
  EditingFormSchema,
  EditingSessionSchema,
  RequestSchema,
  TaskModelsSchema,
} from "./protocol.js";
import type {
  Detail, Draft, EditingForm, EditingOperation, EditingSession,
  EditingTarget, Job, LegacyEditing, Request, TaskModels,
} from "./protocol.js";

type EditingRequest = Extract<Request, { kind: "draft" | "admit" | "edit" }>;
export interface EditingOwner { sessionId: string; operationId: string }

/** Internal adapters. Both the native host and the sample host own this module. */
export interface EditingIO {
  records(): readonly EditingSession[];
  persist(records: EditingSession[]): void;
  repository(id: string): void;
  defaults(repoId: string, key: string | null): TaskModels;
  detail(repoId: string, key: string): Promise<Detail>;
  start(request: EditingRequest, owner: EditingOwner): Promise<Job>;
  stop(jobId: string): Promise<void>;
  id(): string;
}

export function contractDraft(detail: Detail): Draft {
  return {
    outcome: detail.contract.outcome,
    paths: detail.contract.scope.paths_allowed,
    criteria: "acceptance_criteria" in detail.contract
      ? detail.contract.acceptance_criteria.flatMap((entry) =>
          entry.expected_verification.kind === "manual" ? [] : [{
            text: entry.text,
            assertion: entry.expected_verification.assertion,
            kind: entry.expected_verification.kind,
          }])
      : [],
  };
}

export function editingForm(models: TaskModels, detail?: Detail): EditingForm {
  return {
    draft: detail ? contractDraft(detail) : { outcome: "", criteria: [], paths: ["src/**", "test/**"] },
    models: TaskModelsSchema.strip().parse(models),
    step: detail ? 2 : 1,
    editing: null,
    criterion: { text: "", assertion: "", kind: "test" },
    newPath: null,
  };
}

const pending = (operation: EditingOperation | null): boolean =>
  operation !== null && ["accepted", "running", "stopping"].includes(operation.state);

/** Local editable work and its operation receipts, never canonical Ticket state. */
export class ContractEditing {
  private readonly reconciling = new Map<string, Promise<void>>();
  private readonly unsettled = new Map<string, { job: Job; error: string }>();
  private readonly io: EditingIO;
  constructor(io: EditingIO) { this.io = io; }

  read(id: string): EditingSession {
    const record = this.io.records().find((entry) => entry.id === id);
    if (!record) throw new Error("This editing session is no longer available. Open the task again.");
    const session = EditingSessionSchema.parse(structuredClone(record));
    const failure = this.unsettled.get(id);
    if (failure) {
      session.phase = "outcome-unknown";
      session.error = `The command finished, but its editing receipt could not be saved: ${failure.error}. Check Home before retrying.`;
    }
    return session;
  }

  private update(id: string, apply: (record: EditingSession) => void): EditingSession {
    const next = this.read(id);
    apply(next);
    const valid = EditingSessionSchema.parse(next);
    this.io.persist(this.io.records().map((record) => record.id === id ? valid : record));
    return this.read(id);
  }

  recover(): void {
    for (const session of this.io.records()) {
      if (!pending(session.operation)) continue;
      this.update(session.id, (next) => {
        next.operation!.state = "interrupted";
        next.operation!.error = "Focrux closed before this operation reported its outcome.";
        next.phase = "outcome-unknown";
        next.error = "Your edits were saved. Check the task's recorded outcome before submitting again.";
      });
    }
  }

  async open(target: EditingTarget, legacy?: LegacyEditing): Promise<EditingSession> {
    const find = (): EditingSession | undefined => {
      const records = this.io.records();
      if (target.kind === "session") return records.find((entry) => entry.id === target.id);
      if (target.kind === "new") return records.find((entry) => entry.resumeNew && entry.phase !== "discarded");
      const candidates = records.filter((entry) => entry.repoId === target.repoId && entry.phase !== "discarded");
      // A durable result reserves its Ticket before the asynchronous canonical read.
      return candidates.find((entry) => entry.key === target.key) ??
        candidates.find((entry) => entry.operation?.resultKey === target.key && !entry.operation.reconciled);
    };
    let existing = find();
    if (!existing && target.kind === "session") return this.read(target.id);
    if (!existing) {
      const repoId = target.kind === "new" && legacy ? legacy.repoId : target.kind === "session" ? "" : target.repoId;
      this.io.repository(repoId);
      const key = target.kind === "ticket" ? target.key : legacy?.key ?? null;
      const detail = key ? await this.io.detail(repoId, key) : undefined;
      // Another open request may have created the same target while detail was read.
      existing = find();
      if (!existing) {
        const records = this.io.records().filter((entry) => entry.phase !== "discarded");
        if (records.filter((entry) => entry.phase !== "ready").length >= 100)
          throw new Error("There are 100 unfinished editing sessions. Discard unused edits before creating another.");
        existing = EditingSessionSchema.parse({
          version: 1, id: this.io.id(), repoId, key,
          digest: legacy?.digest ?? detail?.digest ?? null,
          revision: 0, resumeNew: target.kind === "new",
          form: legacy?.form ?? editingForm(this.io.defaults(repoId, key), detail),
          phase: legacy?.pending ? "outcome-unknown" : "editing",
          error: legacy?.pending ? "An older draft has an unconfirmed job. Your text is preserved; check Home before submitting again." : null,
          operation: null,
        });
        this.io.persist([...records, existing]);
      }
    }
    const unsettled = this.unsettled.get(existing.id);
    if (unsettled) {
      try { await this.settled(unsettled.job); } catch { return this.read(existing.id); }
    }
    await this.reconcile(existing.id);
    const current = this.read(existing.id);
    try { this.io.repository(current.repoId); } catch {
      return this.update(current.id, (next) => {
        if (next.phase === "discarded") return;
        next.phase = "conflict";
        next.error = next.key || next.operation
          ? "This repository was disconnected. Your edits are preserved; reconnect it or discard these saved edits."
          : "This repository was disconnected. Choose a connected repository to keep working with these edits.";
      });
    }
    if (current.key && !pending(current.operation) && current.phase !== "discarded") {
      const detail = await this.io.detail(current.repoId, current.key);
      return this.update(current.id, (next) => {
        if (pending(next.operation) || next.phase === "discarded" || next.revision !== current.revision) return;
        const manual = "acceptance_criteria" in detail.contract && detail.contract.acceptance_criteria.some(
          (entry) => entry.expected_verification.kind === "manual",
        );
        if (detail.digest !== next.digest || detail.ticket.approved_at || manual) {
          next.phase = "conflict";
          next.error = manual
            ? "This contract has named manual reviewers. Edit it with the CLI to preserve those assignments."
            : "The saved contract changed or was approved. Your local edits are preserved; open the current contract to review it.";
        } else if (next.phase === "ready") next.phase = "editing";
        if (next.phase !== current.phase || next.error !== current.error) next.revision++;
      });
    }
    return current;
  }

  save(id: string, revision: number, repoId: string, form: EditingForm): EditingSession {
    const valid = EditingFormSchema.parse(form);
    this.io.repository(repoId);
    return this.update(id, (session) => {
      if (session.revision !== revision) throw new Error("These edits changed in another view. Your unsaved text is still here; reopen the saved session to compare.");
      if (pending(session.operation) || (session.operation && !session.operation.reconciled) || session.phase === "discarded") throw new Error("Wait for this editing operation to settle before changing its submitted fields.");
      if (session.repoId !== repoId && (session.key || session.operation)) throw new Error("This session is tied to its original repository.");
      if (session.repoId !== repoId) { session.phase = "editing"; session.error = null; }
      session.repoId = repoId;
      session.form = valid;
      session.revision++;
    });
  }

  async submit(id: string, revision: number, operationId: string, intent: "draft" | "compile"): Promise<EditingSession> {
    const session = this.read(id);
    this.io.repository(session.repoId);
    if (session.operation?.id === operationId) {
      if (session.operation.inputRevision !== revision || session.operation.intent !== intent)
        throw new Error("This operation identity was already used with different input.");
      return session;
    }
    if (session.revision !== revision || session.phase !== "editing" || pending(session.operation))
      throw new Error("Restore the current saved edits before submitting this contract.");
    if (session.form.editing !== null) throw new Error("Save or discard the unfinished criterion before compiling.");
    if (intent === "draft" && session.key) throw new Error("This session already has a Ticket. Edit its criteria instead of admitting it again.");
    const request: EditingRequest = intent === "draft"
      ? { kind: "draft", repoId: session.repoId, outcome: session.form.draft.outcome, models: session.form.models }
      : session.key && session.digest
        ? { kind: "edit", repoId: session.repoId, key: session.key, digest: session.digest, draft: DraftSchema.parse(session.form.draft), models: session.form.models }
        : { kind: "admit", repoId: session.repoId, draft: DraftSchema.parse(session.form.draft), models: session.form.models };
    RequestSchema.parse(request);
    this.update(id, (next) => {
      next.revision++;
      next.phase = "working";
      next.error = null;
      next.operation = { id: operationId, intent, inputRevision: revision, jobId: null, state: "accepted", resultKey: null, error: null, reconciled: false };
    });
    try {
      await this.io.start(request, { sessionId: id, operationId });
    } catch (error) {
      // No job association means the host refused before dispatch (for example, a busy slot).
      this.update(id, (next) => {
        if (next.operation?.id !== operationId) return;
        next.operation.error = String(error instanceof Error ? error.message : error);
        next.operation.state = "failed";
        next.operation.reconciled = next.operation.jobId === null;
        next.phase = next.operation.jobId === null ? "editing" : "outcome-unknown";
        next.error = next.operation.error;
      });
    }
    return this.read(id);
  }

  /** Called synchronously after slot reservation and before the CLI can run. */
  started(owner: EditingOwner, job: Job): void {
    this.update(owner.sessionId, (session) => {
      if (session.operation?.id !== owner.operationId || session.repoId !== job.repoId || session.key !== job.key)
        throw new Error("The editing operation does not belong to this job.");
      session.operation.jobId = job.id;
      session.operation.state = "running";
    });
  }

  async settled(job: Job): Promise<void> {
    const owner = job.editing;
    if (!owner) return;
    const session = this.io.records().find((entry) => entry.id === owner.sessionId);
    if (!session || session.operation?.id !== owner.operationId || session.operation.jobId !== job.id || session.repoId !== job.repoId) return;
    try {
      this.update(session.id, (next) => {
        next.operation!.state = job.state;
        next.operation!.resultKey = job.resultKey;
        next.operation!.error = job.error;
      });
      this.unsettled.delete(session.id);
    } catch (error) {
      this.unsettled.set(session.id, { job: structuredClone(job), error: String(error instanceof Error ? error.message : error) });
      throw error;
    }
    // The result identity is durable before the asynchronous canonical read.
    await this.reconcile(session.id);
  }

  private async reconcile(id: string): Promise<void> {
    const inflight = this.reconciling.get(id);
    if (inflight) return inflight;
    const session = this.read(id), operation = session.operation;
    if (!operation || operation.reconciled || pending(operation) || session.phase === "discarded") return;
    const work = (async () => {
      try {
        const key = operation.resultKey ?? session.key;
        const detail = key ? await this.io.detail(session.repoId, key) : null;
        if (detail && detail.ticket.key !== key) throw new Error("The recorded result belongs to another task.");
        this.update(id, (next) => {
          if (next.operation?.id !== operation.id || next.phase === "discarded" || next.revision !== session.revision) return;
          if (detail && operation.state === "completed" && operation.resultKey) {
            const otherEditor = this.io.records().find((entry) => entry.id !== id && entry.repoId === session.repoId &&
              entry.key === detail.ticket.key && entry.phase !== "discarded");
            if (!next.key && otherEditor) {
              next.phase = "conflict";
              next.error = "Another editor already holds this task. Your submitted fields remain here; open the current contract to continue from that editor.";
            } else {
              next.key = detail.ticket.key;
              next.digest = detail.digest;
              next.form = { ...next.form, draft: contractDraft(detail), step: 2, editing: null, newPath: null };
              next.phase = operation.intent === "draft" ? "editing" : "ready";
              if (operation.intent === "compile") next.resumeNew = false;
              next.error = null;
            }
          } else {
            next.phase = detail && detail.digest === next.digest && !detail.ticket.approved_at ? "editing" : "outcome-unknown";
            next.error = operation.error ?? "The operation stopped without a confirmed result. Check Home and the canonical contract before submitting again.";
          }
          next.operation.reconciled = true;
          next.revision++;
        });
      } catch (error) {
        this.update(id, (next) => {
          if (next.operation?.id !== operation.id || next.phase === "discarded" || next.revision !== session.revision) return;
          next.phase = "outcome-unknown";
          next.error = `Your edits and operation were saved, but the recorded result could not be read: ${String(error instanceof Error ? error.message : error)}`;
        });
      }
    })();
    this.reconciling.set(id, work);
    try { await work; } finally { this.reconciling.delete(id); }
  }

  async stop(id: string): Promise<EditingSession> {
    const session = this.read(id);
    if (session.operation?.jobId && pending(session.operation)) {
      await this.io.stop(session.operation.jobId);
      // The command may settle during cancellation; never regress its terminal receipt.
      if (pending(this.read(id).operation)) this.update(id, (next) => { next.operation!.state = "stopping"; });
    }
    return this.read(id);
  }

  discard(id: string, revision: number): EditingSession {
    return this.update(id, (session) => {
      if (session.revision !== revision || pending(session.operation)) throw new Error("Wait for the current editing operation before discarding its saved edits.");
      session.phase = "discarded";
      session.resumeNew = false;
      session.revision++;
    });
  }
}
