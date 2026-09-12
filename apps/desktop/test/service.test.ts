import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DesktopService, type ServiceOptions } from "../src/host/service.js";
import { runProcess, redact } from "../src/host/process.js";
import { SettingsSchema } from "../src/shared/protocol.js";
import type { Draft, Job } from "../src/shared/protocol.js";
import type { RunBundle } from "@focrux/contracts";

const temporary: string[] = [];
const services: DesktopService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.shutdown()));
  for (const path of temporary.splice(0))
    rmSync(path, { recursive: true, force: true });
});
function fixture(process?: typeof runProcess) {
  const root = mkdtempSync(join(tmpdir(), "focrux-desktop-"));
  temporary.push(root);
  const repo = join(root, "repository with spaces");
  mkdirSync(repo);
  for (const args of [
    ["init", "--initial-branch=main"],
    ["config", "user.name", "Desktop Test"],
    ["config", "user.email", "desktop@example.invalid"],
    ["config", "commit.gpgsign", "false"],
  ])
    execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  writeFileSync(join(repo, "README.md"), "# Test repository\n");
  execFileSync("git", ["add", "README.md"], { cwd: repo });
  execFileSync("git", ["commit", "-m", "Initial test state"], {
    cwd: repo,
    stdio: "ignore",
  });
  const options: ServiceOptions = {
    dataDirectory: join(root, "profile"),
    cliPath: resolve("../cli/dist/focrux.js"),
    nodeBinary: globalThis.process.execPath,
    version: "test",
    changed: () => undefined,
    io: {
      chooseDirectory: async () => repo,
      openPath: async () => undefined,
      openExternal: async () => undefined,
      saveFile: async (
        _name: string,
        _content: string,
      ): Promise<string | null> => null,
      notify: () => undefined,
    },
    ...(process ? { process } : {}),
  };
  return {
    repo,
    root,
    service: (() => {
      const service = new DesktopService(options);
      services.push(service);
      return service;
    })(),
    options,
  };
}
const draft: Draft = {
  outcome: "Make errors actionable $(touch should-not-exist) `whoami`",
  criteria: [
    {
      text: "The user can retry",
      assertion: "The retry button is visible after failure",
      kind: "test",
    },
  ],
  paths: ["src/**", "test/**"],
};
async function finished(service: DesktopService, id: string): Promise<Job> {
  for (let count = 0; count < 100; count++) {
    const job = (await service.snapshot()).jobs.find(
      (entry) => entry.id === id,
    )!;
    if (!["running", "stopping"].includes(job.state)) return job;
    await delay(20);
  }
  throw new Error("Desktop command did not settle");
}
describe("desktop bridge against the actual bundled CLI", () => {
  it("shares native snapshot, detail and output reads while preserving repository scope", async () => {
    const calls: string[] = [];
    const runner: typeof runProcess = async (binary, args, options) => {
      calls.push(binary === "git" ? args.join(" ") : args[1]!);
      return runProcess(binary, args, options);
    };
    const { service, repo } = fixture(runner);
    const registered = await service.registerRepository(repo);
    await finished(service, (await service.request({ kind: "admit", repoId: registered.id, draft })).id);
    calls.length = 0;
    const [first, second, detail, output] = await Promise.all([
      service.snapshot(), service.snapshot(), service.detail(registered.id, "FCX-1"),
      service.request({ kind: "output", repoId: registered.id, key: "FCX-1" }),
    ]);
    expect(first.tasks).toEqual(second.tasks);
    expect(detail.ticket.key).toBe("FCX-1");
    expect(output).toEqual({ transcript: null, diff: null, notes: [] });
    expect(calls.filter((call) => call === "list")).toHaveLength(1);
    expect(calls.filter((call) => call === "inspect")).toHaveLength(1);
    expect(calls.filter((call) => call.startsWith("--no-optional-locks"))).toHaveLength(1);
    expect(calls.filter((call) => call === "rev-parse HEAD")).toHaveLength(1);
  });

  it("refreshes a native detail read that overlaps a CLI edit", async () => {
    let held: (() => void) | undefined, holdNext = false;
    let markReadHeld!: () => void;
    const readHeld = new Promise<void>((resolve) => { markReadHeld = resolve; });
    const runner: typeof runProcess = async (binary, args, options) => {
      const result = await runProcess(binary, args, options);
      if (holdNext && args[1] === "list") {
        holdNext = false;
        await new Promise<void>((resolve) => { held = resolve; markReadHeld(); });
      }
      return result;
    };
    const { service, repo, options } = fixture(runner);
    const registered = await service.registerRepository(repo);
    await finished(service, (await service.request({ kind: "admit", repoId: registered.id, draft })).id);
    const initial = await service.detail(registered.id, "FCX-1");
    holdNext = true;
    const reading = service.detail(registered.id, "FCX-1");
    try {
      await readHeld;
      const settled = new Promise<void>((resolve) => {
        options.changed = (change) => {
          if (change.kind === "records" && change.job?.kind === "edit") resolve();
        };
      });
      const job = await service.request({ kind: "edit", repoId: registered.id, key: "FCX-1", digest: initial.digest, draft: { ...draft, outcome: "The newer saved contract" } });
      await settled;
      expect(job.state).toBe("completed");
    } finally {
      held?.();
    }
    const latest = await reading;
    expect(latest.contract.outcome).toBe("The newer saved contract");
    expect(latest.contract.version).toBe(latest.ticket.plan_version);
  });

  it("recovers incomplete editing fields from disk and retains admission ownership beyond the job journal", async () => {
    const runner: typeof runProcess = async (binary, args, options) => args[1] === "doctor"
      ? { code: 0, stdout: "{}", stderr: "", cancelled: false }
      : runProcess(binary, args, options);
    const { service, repo, options } = fixture(runner);
    const registered = await service.registerRepository(repo);
    const initial = await service.request({ kind: "editingOpen", target: { kind: "new", repoId: registered.id } });
    const form = { ...initial.form, draft, editing: 0, criterion: { text: "Unfinished", assertion: "", kind: "query" as const }, newPath: "packages/", models: { ...initial.form.models, executorModel: "saved-model" } };
    const saved = await service.request({ kind: "editingSave", id: initial.id, revision: initial.revision, repoId: registered.id, form });
    await service.shutdown();
    const restarted = new DesktopService(options);
    services.push(restarted);
    const recovered = await restarted.request({ kind: "editingOpen", target: { kind: "new", repoId: registered.id } });
    expect(recovered).toEqual(saved);
    expect((await restarted.snapshot()).tasks).toHaveLength(0);
    expect(statSync(join(options.dataDirectory, "workspace.json")).mode & 0o777).toBe(0o600);
    const compiling = await restarted.request({ kind: "editingSave", id: saved.id, revision: saved.revision, repoId: registered.id, form: { ...form, editing: null, newPath: null } });
    const operationId = randomUUID();
    const settled = new Promise<void>((resolve) => {
      options.changed = (change) => {
        if (change.kind === "records" && change.job?.editing?.operationId === operationId) resolve();
      };
    });
    await restarted.request({ kind: "editingSubmit", id: saved.id, revision: compiling.revision, operationId, intent: "compile" });
    await settled;
    expect(await restarted.request({ kind: "editingRead", id: saved.id })).toMatchObject({ phase: "ready", key: "FCX-1" });
    for (let count = 0; count < 41; count++) {
      const job = await restarted.request({ kind: "doctor", repoId: registered.id, writeConfig: false });
      await vi.waitFor(() => expect(job.state).toBe("completed"), { interval: 5 });
    }
    expect((await restarted.snapshot()).jobs.some((job) => job.kind === "admit")).toBe(false);
    await restarted.shutdown();
    const again = new DesktopService(options);
    services.push(again);
    const receipt = await again.request({ kind: "editingSubmit", id: saved.id, revision: compiling.revision, operationId, intent: "compile" });
    expect(receipt).toMatchObject({ key: "FCX-1", phase: "ready", operation: { state: "completed", resultKey: "FCX-1" } });
    expect((await again.snapshot()).tasks).toHaveLength(1);
    const contract = await again.detail(registered.id, "FCX-1");
    expect(contract.ticket.approved_at).toBeNull();
    expect(contract.contract.outcome).toBe(draft.outcome);
  });

  it("keeps local edits when the CLI changes the saved contract", async () => {
    const { service, repo } = fixture();
    const registered = await service.registerRepository(repo);
    await finished(service, (await service.request({ kind: "admit", repoId: registered.id, draft })).id);
    const initial = await service.request({ kind: "editingOpen", target: { kind: "ticket", repoId: registered.id, key: "FCX-1" } });
    const local = await service.request({ kind: "editingSave", id: initial.id, revision: initial.revision, repoId: registered.id, form: { ...initial.form, draft: { ...draft, outcome: "Local unfinished text" } } });
    await finished(service, (await service.request({ kind: "edit", repoId: registered.id, key: "FCX-1", digest: initial.digest!, draft: { ...draft, outcome: "Changed through CLI authority" } })).id);
    const reopened = await service.request({ kind: "editingOpen", target: { kind: "session", id: initial.id } });
    expect(reopened).toMatchObject({ phase: "conflict", form: local.form, digest: initial.digest });
    await expect(service.request({ kind: "editingSubmit", id: local.id, revision: reopened.revision, operationId: randomUUID(), intent: "compile" })).rejects.toThrow(/Restore/);
  });

  it.each([false, true])("checks the selected Codex providers through a private host config (write: %s)", async (writeConfig) => {
    const invocations: Array<{ args: readonly string[]; path: string; config: unknown; mode: number }> = [];
    const runner: typeof runProcess = async (binary, args, options) => {
      if (args[1] === "doctor") {
        const path = args[args.indexOf("--config") + 1]!;
        invocations.push({
          args,
          path,
          config: JSON.parse(readFileSync(path, "utf8")) as unknown,
          mode: statSync(path).mode & 0o777,
        });
        return { code: 0, stdout: "{}", stderr: "", cancelled: false };
      }
      return runProcess(binary, args, options);
    };
    const { service, repo, options } = fixture(runner);
    const registered = await service.registerRepository(repo);
    await service.request({
      kind: "saveSettings",
      settings: SettingsSchema.parse({
        executorProvider: "codex-cli",
        executorModel: "gpt-5.6-terra",
        reviewerProvider: "codex-cli",
        reviewerModel: "gpt-6-astra",
      }),
    });
    const job = await finished(service, (await service.request({
      kind: "doctor",
      repoId: registered.id,
      writeConfig,
    })).id);
    expect(job.state).toBe("completed");
    expect(invocations).toHaveLength(1);
    const invocation = invocations[0]!;
    expect(dirname(invocation.path)).toBe(options.dataDirectory);
    expect(invocation.mode).toBe(0o600);
    expect(invocation.config).toEqual({
      agent_binary: "codex",
      agent_provider: "codex-cli",
      model: "gpt-5.6-terra",
      reviewer_provider: "codex-cli",
      reviewer_model: "gpt-6-astra",
    });
    expect(invocation.args).toEqual([
      options.cliPath,
      "doctor",
      "--json",
      "--config",
      invocation.path,
      ...(writeConfig ? ["--write-config"] : []),
      "--repo",
      registered.path,
    ]);
  });

  it("displays only the task's bounded, hash-matching retained output", async () => {
    const { service, repo } = fixture();
    const registered = await service.registerRepository(repo);
    await finished(
      service,
      (await service.request({ kind: "admit", repoId: registered.id, draft }))
        .id,
    );
    const detail = await service.detail(registered.id, "FCX-1");
    const body =
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Completed the change."}]}}';
    const hash = createHash("sha256").update(body).digest("hex");
    const objects = join(repo, ".focrux", "bundles", "objects");
    mkdirSync(objects, { recursive: true });
    const path = join(objects, hash);
    writeFileSync(path, body);
    const bundle: RunBundle = {
      schema_version: 1,
      bundle_id: "bundle_0000000000000001",
      kind: "execution",
      created_at: new Date().toISOString(),
      subject_id: "att_output",
      ticket_id: detail.ticket.ticket_id,
      inputs: {},
      context_manifest: [],
      versions: {
        code: "test",
        prompt: "test",
        policy: "test",
        model: "test",
        tool: "test",
      },
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cost_micros: 0,
        cost_basis: "not_incurred",
        wall_clock_ms: 1000,
      },
      artifacts: [
        {
          name: "transcript.jsonl",
          sha256: hash,
          bytes: Buffer.byteLength(body),
          retained: true,
          media_type: "application/x-ndjson",
        },
      ],
      errors: [],
      transitions: [],
      retention: { class: "raw_transcript", expires_at: null },
      redaction: {
        secret_content_sha256: [],
        secret_value_count: 0,
        redactions: 0,
        excluded_paths: [],
      },
      replayability: "re_executable",
      replayability_reason: "test",
    };
    detail.attempts.push({
      id: "att_output",
      run: 1,
      round: 0,
      startedAt: bundle.created_at,
      outcome: "approved",
      termination: "completed",
      model: "test",
      costMicros: 0,
      costBasis: "not_incurred",
      partial: false,
      ceilings: [],
      review: null,
      reviewDecision: null,
      changes: [],
      checks: [],
      verification: null,
      bundles: [bundle],
    });
    vi.spyOn(service, "detail").mockResolvedValue(detail);
    const request = {
      kind: "output" as const,
      repoId: registered.id,
      key: "FCX-1",
      attemptId: "att_output",
    };
    expect((await service.request(request)).transcript).toBe(body);
    detail.attempts.push({ ...detail.attempts[0]!, id: "att_newer", bundles: [] });
    expect((await service.request(request)).transcript).toBe(body);
    await expect(service.request({ ...request, attemptId: "att_foreign" })).rejects.toThrow(/does not belong/);
    bundle.ticket_id = "ticket_someone_else";
    expect((await service.request(request)).transcript).toBeNull();
    bundle.ticket_id = detail.ticket.ticket_id;
    writeFileSync(path, "changed after sealing");
    expect(await service.request(request)).toMatchObject({
      transcript: null,
      notes: [expect.stringContaining("content hash")],
    });
    writeFileSync(path, Buffer.alloc(2_000_001));
    expect(await service.request(request)).toMatchObject({
      transcript: null,
      notes: [expect.stringContaining("2 MB")],
    });
    rmSync(path);
    const other = join(repo, "outside-record.txt");
    writeFileSync(other, body);
    symlinkSync(other, path);
    await expect(service.request(request)).rejects.toThrow("symlink");
  });
  it("exports the visible archive across repositories and preserves closed outcomes", async () => {
    const { service, options, repo } = fixture();
    const registered = await service.registerRepository(repo);
    await finished(
      service,
      (await service.request({ kind: "admit", repoId: registered.id, draft }))
        .id,
    );
    const snapshot = await service.snapshot(),
      ticket = snapshot.tasks[0]!.ticket;
    snapshot.tasks = [
      {
        repoId: registered.id,
        repository: "alpha",
        ticket: {
          ...ticket,
          key: "FCX-1",
          state: "merged",
          title: "Fix, with commas",
        },
      },
      {
        repoId: "80000000-0000-4000-8000-000000000002",
        repository: "beta",
        ticket: {
          ...ticket,
          key: "FCX-2",
          state: "closed",
          title: "=HYPERLINK(unsafe)",
        },
      },
      {
        repoId: registered.id,
        repository: "alpha",
        ticket: {
          ...ticket,
          key: "FCX-3",
          state: "executing",
          title: "Still running",
        },
      },
    ];
    // The export covers what has been filed by hand; a completed ticket still on Home is not in it.
    snapshot.archived = [registered.id + ":FCX-1", "80000000-0000-4000-8000-000000000002:FCX-2"];
    vi.spyOn(service, "snapshot").mockResolvedValue(snapshot);
    const save = vi.spyOn(options.io, "saveFile").mockResolvedValue(null);
    await service.request({
      kind: "exportArchive",
      repoId: null,
      search: "",
      outcome: "all",
      sort: "title",
    });
    const csv = save.mock.calls[0]![1];
    expect(csv).toContain('"Fix, with commas"');
    expect(csv).toContain('"\'=HYPERLINK(unsafe)"');
    expect(csv).toContain('"beta","closed"');
    expect(csv).not.toContain("Still running");
    await service.request({
      kind: "exportArchive",
      repoId: registered.id,
      search: "",
      outcome: "all",
      sort: "title",
    });
    expect(save.mock.calls[1]![1]).not.toContain("beta");
  });
  it("admits, lists, inspects and edits a native ticket without running a provider", async () => {
    const { service } = fixture();
    const repo = await service.request({ kind: "chooseRepository" });
    expect(repo?.name).toBe("repository with spaces");
    const admitted = await finished(
      service,
      (await service.request({ kind: "admit", repoId: repo!.id, draft })).id,
    );
    expect(admitted.error).toBeNull();
    expect(admitted.resultKey).toBe("FCX-1");
    const detail = await service.request({
      kind: "detail",
      repoId: repo!.id,
      key: "FCX-1",
    });
    expect(detail.contract.outcome).toBe(draft.outcome);
    expect(detail.ticket.approved_at).toBeNull();
    expect(detail.attempts).toEqual([]);
    const edited = await finished(
      service,
      (
        await service.request({
          kind: "edit",
          repoId: repo!.id,
          key: "FCX-1",
          digest: detail.digest,
          draft: { ...draft, outcome: "Show a helpful retry action" },
        })
      ).id,
    );
    expect(edited.state).toBe("completed");
    const stale = await finished(
      service,
      (
        await service.request({
          kind: "edit",
          repoId: repo!.id,
          key: "FCX-1",
          digest: detail.digest,
          draft,
        })
      ).id,
    );
    expect(stale.state).toBe("failed");
    expect(stale.error).toContain("changed since");
  });
  it("reserves one mutation slot before awaiting the child", async () => {
    const { service } = fixture();
    const repo = await service.request({ kind: "chooseRepository" });
    const job = await service.request({
      kind: "admit",
      repoId: repo!.id,
      draft,
    });
    await expect(
      service.request({ kind: "admit", repoId: repo!.id, draft }),
    ).rejects.toThrow("Another command");
    expect((await finished(service, job.id)).state).toBe("completed");
  });
  it("preserves kill switches, tightens limits, selects Codex and requires explicit publication", async () => {
    let override: Record<string, unknown> | null = null;
    const runner: typeof runProcess = async (binary, args, options) => {
      if (args[1] === "run") {
        override = JSON.parse(
          readFileSync(args[args.indexOf("--config") + 1]!, "utf8"),
        ) as Record<string, unknown>;
        return { code: 0, stdout: "{}", stderr: "", cancelled: false };
      }
      return runProcess(binary, args, options);
    };
    const { service, repo } = fixture(runner),
      registered = await service.registerRepository(repo);
    const admitted = await finished(
      service,
      (await service.request({ kind: "admit", repoId: registered.id, draft }))
        .id,
    );
    expect(admitted.state).toBe("completed");
    writeFileSync(
      join(repo, ".focrux", "config.json"),
      JSON.stringify({
        publish: true,
        merge: "loop",
        limits: {
          organisation: "test",
          limits: { attempt_commands: 4, attempt_wall_clock_ms: 60_000 },
          kill_switches: { global_read_only: true },
        },
      }),
    );
    await service.request({
      kind: "saveSettings",
      settings: SettingsSchema.parse({
        executorProvider: "codex-cli",
        executorModel: "gpt-5.6-terra",
        executorSkills: ["codebase-design"],
        reviewerProvider: "claude-cli",
      }),
    });
    const detail = await service.detail(registered.id, "FCX-1");
    const ran = await finished(
      service,
      (
        await service.request({
          kind: "run",
          repoId: registered.id,
          key: "FCX-1",
          digest: detail.digest,
          approve: true,
          publish: false,
          resumeFrom: null,
        })
      ).id,
    );
    expect(ran.error).toBeNull();
    expect(override).toMatchObject({
      agent_binary: "codex",
      agent_provider: "codex-cli",
      executor_skills: ["codebase-design"],
      publish: false,
      merge: "person",
      limits: {
        limits: { attempt_commands: 4, attempt_wall_clock_ms: 60_000 },
        kill_switches: { global_read_only: true },
      },
    });
    expect(
      (await service.detail(registered.id, "FCX-1")).ticket.approved_at,
    ).not.toBeNull();
    const forbidden = await finished(
      service,
      (
        await service.request({
          kind: "edit",
          repoId: registered.id,
          key: "FCX-1",
          digest: detail.digest,
          draft,
        })
      ).id,
    );
    expect(forbidden.state).toBe("failed");
  });
  it("edits the actual manifest, preserves commands and refuses a stale save", async () => {
    const { service, repo } = fixture();
    const registered = await service.registerRepository(repo);
    mkdirSync(join(repo, ".focrux"));
    const configPath = join(repo, ".focrux", "config.json");
    const config = {
      publish: false,
      protected_paths: ["infra/**"],
      materialization_manifest: {
        manifest_version: 1,
        repository_id: "repo_0000000000000001",
        source_checkout: repo,
        entries: [],
        install: {
          kind: "none",
          package_manager: "none",
          offline_preferred: true,
          lifecycle_scripts: { policy: "disabled", exception: null },
          command: ["true"],
          pinned: true,
        },
        verify: { command: ["node", "--test"], timeout_ms: 1000 },
        isolation: {
          mode: "serialized",
          port_range_size: 0,
          port_range_start: 20000,
          port_range_end: 21000,
          database_schema_prefix: null,
        },
      },
    };
    writeFileSync(configPath, JSON.stringify(config));
    const opened = await service.request({
      kind: "manifest",
      repoId: registered.id,
    });
    expect(opened.testCommand).toBe("node --test");
    const value = {
      ...opened.value,
      offLimits: ["infra/**", "migrations/**"],
      entries: [
        {
          path: ".env.local",
          source_path: ".env.local",
          kind: "file" as const,
          strategy: "copy" as const,
          secret: true,
          required: true,
          reason: "Local configuration",
        },
      ],
    };
    await service.request({
      kind: "saveManifest",
      repoId: registered.id,
      digest: opened.digest,
      value,
    });
    const reopened = await service.request({
      kind: "manifest",
      repoId: registered.id,
    });
    expect(reopened.value).toEqual(value);
    expect(reopened.testCommand).toBe("node --test");
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toMatchObject({
      publish: false,
      materialization_manifest: {
        install: config.materialization_manifest.install,
      },
    });
    await expect(
      service.request({
        kind: "saveManifest",
        repoId: registered.id,
        digest: opened.digest,
        value: opened.value,
      }),
    ).rejects.toThrow("configuration changed");
  });
  it("opens and saves off-limits paths where nothing names a package manager", async () => {
    const { service, repo } = fixture();
    const registered = await service.registerRepository(repo);
    mkdirSync(join(repo, ".focrux"));
    // A pinned manifest of the kind `--write-config` writes for such a
    // repository: an install that installs nothing, and `git status
    // --porcelain` as the verification.
    writeFileSync(
      join(repo, ".focrux", "config.json"),
      JSON.stringify({
        publish: false,
        materialization_manifest: {
          manifest_version: 1,
          repository_id: "repo_0000000000000001",
          source_checkout: ".",
          entries: [],
          install: {
            kind: "none",
            package_manager: "none",
            offline_preferred: false,
            lifecycle_scripts: { policy: "disabled", exception: null },
            command: ["true"],
            pinned: true,
          },
          verify: {
            command: ["git", "status", "--porcelain"],
            timeout_ms: 900_000,
          },
          isolation: {
            mode: "parallel",
            port_range_size: 10,
            port_range_start: 41000,
            port_range_end: 41009,
            database_schema_prefix: null,
          },
        },
      }),
    );
    const opened = await service.request({
      kind: "manifest",
      repoId: registered.id,
    });
    expect(opened.testCommand).toBe("git status --porcelain");
    expect(opened.value.entries).toEqual([]);
    await service.request({
      kind: "saveManifest",
      repoId: registered.id,
      digest: opened.digest,
      value: { ...opened.value, offLimits: ["infra/**"] },
    });
    const reopened = await service.request({
      kind: "manifest",
      repoId: registered.id,
    });
    expect(reopened.value.offLimits).toEqual(["infra/**"]);
  });
  it("refuses unknown operations and symlink ticket stores", async () => {
    const { service, repo, root } = fixture();
    await expect(
      service.request({ kind: "shell", command: "touch surprise" } as never),
    ).rejects.toThrow();
    const outside = join(root, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(repo, ".focrux"));
    await expect(service.registerRepository(repo)).rejects.toThrow("symlink");
  });
  it("preserves preferences and records an interrupted job after restart", async () => {
    const { service, options, root } = fixture();
    await service.request({
      kind: "saveSettings",
      settings: SettingsSchema.parse({
        name: "Morgan",
        executorProvider: "codex-cli",
      }),
    });
    const statePath = join(root, "profile", "workspace.json"),
      state = JSON.parse(readFileSync(statePath, "utf8")) as { jobs: Job[] };
    state.jobs.push({
      id: "80000000-0000-4000-8000-000000000001",
      repoId: "80000000-0000-4000-8000-000000000002",
      key: "FCX-1",
      kind: "run",
      label: "Run",
      state: "running",
      startedAt: new Date().toISOString(),
      endedAt: null,
      log: "",
      error: null,
      resultKey: null,
      result: null,
    });
    writeFileSync(statePath, JSON.stringify(state));
    const restored = await new DesktopService(options).snapshot();
    expect(restored.settings.name).toBe("Morgan");
    expect(restored.jobs[0]?.state).toBe("interrupted");
  });
});
describe("desktop process supervision", () => {
  it("redacts inherited credentials and token forms", () => {
    expect(
      redact("secret-value-123 sk-ant-abcdefghijklmnop", {
        API_KEY: "secret-value-123",
      }),
    ).toBe("[redacted] [redacted]");
  });
  it("does not stream a partial credential split across stderr chunks", async () => {
    const observed: string[] = [];
    const result = await runProcess(
      process.execPath,
      [
        "-e",
        "process.stderr.write('secret-'); setTimeout(() => process.stderr.write('value-123\\n'), 40)",
      ],
      {
        cwd: tmpdir(),
        env: { ...process.env, API_KEY: "secret-value-123" },
        onOutput: (line) => observed.push(line),
      },
    );
    expect(observed.join("")).not.toContain("secret-");
    expect(result.stderr).toContain("[redacted]");
  });
  it("cancels an active subprocess and reports cancellation", async () => {
    const controller = new AbortController();
    const pending = runProcess(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { cwd: tmpdir(), signal: controller.signal },
    );
    await delay(50);
    controller.abort();
    const result = await pending;
    expect(result.cancelled).toBe(true);
    expect(result.code).not.toBe(0);
  });
});
