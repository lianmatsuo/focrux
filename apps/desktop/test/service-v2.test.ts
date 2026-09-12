import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DesktopService, type ServiceOptions } from "../src/host/service.js";
import { runProcess } from "../src/host/process.js";
import { SettingsSchema } from "../src/shared/protocol.js";
import type { Change, Draft, Job } from "../src/shared/protocol.js";

const temporary: string[] = [];
const services: DesktopService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.shutdown()));
  for (const path of temporary.splice(0))
    rmSync(path, { recursive: true, force: true });
});
function fixture(process?: typeof runProcess) {
  const root = mkdtempSync(join(tmpdir(), "focrux-desktop-v2-"));
  temporary.push(root);
  const repo = join(root, "repository");
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
  const notifications: {
    title: string;
    body: string;
    silent: boolean | undefined;
  }[] = [];
  const holds: { hold: boolean; displaySleep: boolean }[] = [];
  const themes: string[] = [];
  const changes: Change[] = [];
  let onBattery = false;
  const options: ServiceOptions = {
    dataDirectory: join(root, "profile"),
    cliPath: resolve("../cli/dist/focrux.js"),
    nodeBinary: globalThis.process.execPath,
    version: "test",
    changed: (change) => {
      changes.push(change);
    },
    io: {
      chooseDirectory: async () => repo,
      openPath: async () => undefined,
      openExternal: async () => undefined,
      saveFile: async (): Promise<string | null> => null,
      notify: (title, body, extra) => {
        notifications.push({ title, body, silent: extra?.silent });
      },
      holdSleep: (hold, displaySleep) => {
        holds.push({ hold, displaySleep });
      },
      onBattery: () => onBattery,
      applyTheme: (theme) => {
        themes.push(theme);
      },
    },
    usageProbe: async () => ({
      plan: "Pro",
      windows: [
        { label: "Session · 5-hour window", usedPercent: 23, resetsAt: null },
      ],
      detail: "Injected.",
    }),
    ...(process ? { process } : {}),
  };
  const service = new DesktopService(options);
  services.push(service);
  return {
    repo,
    root,
    service,
    options,
    notifications,
    holds,
    themes,
    changes,
    setBattery: (value: boolean) => {
      onBattery = value;
    },
  };
}
const draft: Draft = {
  outcome: "Make errors actionable",
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
  for (let count = 0; count < 200; count++) {
    const job = (await service.snapshot()).jobs.find(
      (entry) => entry.id === id,
    )!;
    if (!["running", "stopping"].includes(job.state)) return job;
    await delay(20);
  }
  throw new Error("Desktop command did not settle");
}
function setTicketState(
  repo: string,
  key: string,
  state: string,
): { ticket_id: string } {
  const path = join(repo, ".focrux", "tickets", `${key}.json`);
  const ticket = JSON.parse(readFileSync(path, "utf8")) as {
    state: string;
    ticket_id: string;
  };
  ticket.state = state;
  writeFileSync(path, JSON.stringify(ticket, null, 2));
  return ticket;
}

describe("UI v2 host behaviour", () => {
  it("files already-finished tickets on the first listing, then archives and restores by hand as a preference", async () => {
    const { service, repo, options } = fixture();
    const registered = await service.registerRepository(repo);
    await finished(
      service,
      (await service.request({ kind: "admit", repoId: registered.id, draft }))
        .id,
    );
    await finished(
      service,
      (
        await service.request({
          kind: "admit",
          repoId: registered.id,
          draft: { ...draft, outcome: "A second outcome" },
        })
      ).id,
    );
    setTicketState(repo, "FCX-1", "merged");
    // A profile that predates the preference: the first complete listing files what had already finished.
    const profile = join(options.dataDirectory, "workspace.json");
    const stored = JSON.parse(readFileSync(profile, "utf8")) as Record<
      string,
      unknown
    >;
    delete stored["archived"];
    delete stored["archivedSeeded"];
    writeFileSync(profile, JSON.stringify(stored));
    await service.shutdown();
    const restarted = new DesktopService(options);
    services.push(restarted);
    const snapshot = await restarted.snapshot();
    expect(snapshot.archived).toEqual([registered.id + ":FCX-1"]);
    expect(snapshot.tasks.map((row) => row.ticket.key).sort()).toEqual([
      "FCX-1",
      "FCX-2",
    ]);
    setTicketState(repo, "FCX-2", "merged");
    expect((await restarted.snapshot()).archived).toEqual([
      registered.id + ":FCX-1",
    ]);
    await restarted.request({
      kind: "archive",
      repoId: registered.id,
      keys: ["FCX-2"],
      archived: true,
    });
    expect((await restarted.snapshot()).archived?.sort()).toEqual([
      registered.id + ":FCX-1",
      registered.id + ":FCX-2",
    ]);
    await restarted.request({
      kind: "archive",
      repoId: registered.id,
      keys: ["FCX-1"],
      archived: false,
    });
    expect((await restarted.snapshot()).archived).toEqual([
      registered.id + ":FCX-2",
    ]);
    await expect(
      restarted.request({
        kind: "archive",
        repoId: registered.id,
        keys: ["FCX-9"],
        archived: true,
      }),
    ).rejects.toThrow(/not in the repository/);
    const ticket = JSON.parse(
      readFileSync(join(repo, ".focrux", "tickets", "FCX-1.json"), "utf8"),
    ) as { state: string };
    expect(ticket.state).toBe("merged");
  });

  it("forgets a repository together with its tickets' titles, models and archive marks", async () => {
    const { service, repo } = fixture();
    const registered = await service.registerRepository(repo);
    await finished(
      service,
      (await service.request({ kind: "admit", repoId: registered.id, draft }))
        .id,
    );
    await service.request({
      kind: "rename",
      repoId: registered.id,
      key: "FCX-1",
      title: "Renamed by hand",
    });
    setTicketState(repo, "FCX-1", "merged");
    await service.request({
      kind: "archive",
      repoId: registered.id,
      keys: ["FCX-1"],
      archived: true,
    });
    const before = await service.snapshot();
    expect(before.titles?.[registered.id + ":FCX-1"]).toBe("Renamed by hand");
    expect(before.archived).toEqual([registered.id + ":FCX-1"]);
    await service.request({ kind: "forgetRepository", repoId: registered.id });
    const after = await service.snapshot();
    expect(after.repositories).toEqual([]);
    expect(after.archived).toEqual([]);
    expect(Object.keys(after.titles ?? {})).toEqual([]);
    expect(
      Object.keys(after.taskModels ?? {}).filter((entry) =>
        entry.startsWith(registered.id + ":"),
      ),
    ).toEqual([]);
  });

  it("summarises a ticket from its retained attempts and reports the month's ledger with injected provider windows", async () => {
    const { service, repo } = fixture(async (binary, args, options) =>
      binary === "codex" || binary === "claude"
        ? {
            code: 0,
            stdout: JSON.stringify({ loggedIn: true, authMethod: "oauth" }),
            stderr: "",
            cancelled: false,
          }
        : runProcess(binary, args, options),
    );
    const registered = await service.registerRepository(repo);
    await finished(
      service,
      (await service.request({ kind: "admit", repoId: registered.id, draft }))
        .id,
    );
    const empty = await service.request({
      kind: "taskSummary",
      repoId: registered.id,
      key: "FCX-1",
    });
    expect(empty).toEqual({
      branch: null,
      attempts: 0,
      latestAttemptAt: null,
      costMicros: null,
      costBasis: "none",
      diff: null,
      note: null,
    });
    const { ticket_id } = setTicketState(repo, "FCX-1", "merged");
    mkdirSync(join(repo, ".focrux", "state"), { recursive: true });
    const now = new Date();
    const month =
      now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    writeFileSync(
      join(repo, ".focrux", "state", `${ticket_id}.attempts.json`),
      JSON.stringify({
        ticket_id,
        attempts: [
          {
            attempt_id: "att_1",
            branch: "ayo/fcx-1",
            created_at: `${month}-02T10:00:00.000Z`,
            usage: { cost_micros: 1_250_000, wall_clock_ms: 10 },
            termination: { reason: "wall_clock_exceeded" },
          },
          {
            attempt_id: "att_2",
            branch: "ayo/fcx-1",
            created_at: `${month}-03T10:00:00.000Z`,
            usage: { cost_micros: 750_000, wall_clock_ms: 10 },
            termination: { reason: "completed" },
          },
        ],
      }),
    );
    const summary = await service.request({
      kind: "taskSummary",
      repoId: registered.id,
      key: "FCX-1",
    });
    expect(summary).toMatchObject({
      branch: "ayo/fcx-1",
      attempts: 2,
      costMicros: 2_000_000,
      costBasis: "priced",
      diff: null,
    });
    const usage = await service.request({ kind: "usage" });
    expect(usage.ledger).toEqual({
      month,
      spentMicros: 2_000_000,
      pricedAttempts: 2,
      unpricedAttempts: 0,
      ticketsRun: 1,
      ticketsMerged: 1,
      stoppedAtCeiling: 1,
      averageMergedMicros: 2_000_000,
    });
    expect(
      usage.providers.find((provider) => provider.id === "codex"),
    ).toMatchObject({
      plan: "Pro",
      windows: [{ usedPercent: 23 }],
      detail: "Injected.",
    });
    expect(
      usage.providers.find((provider) => provider.id === "claude")?.windows,
    ).toBeNull();
    expect(
      usage.providers.find((provider) => provider.id === "claude")?.detail,
    ).toMatch(/without spending a turn/);
    await expect(
      service.request({
        kind: "taskSummary",
        repoId: registered.id,
        key: "FCX-7",
      }),
    ).rejects.toThrow(/no longer in the repository/);
  });

  it("notifies on the recorded moment a person asked for, silently unless sound is on, and holds sleep only while a run is live", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runner: typeof runProcess = async (binary, args, options) => {
      if (args[1] === "approve")
        return { code: 0, stdout: "{}", stderr: "", cancelled: false };
      if (args[1] === "run") {
        options.onOutput?.("  worktree /tmp/w on ayo/fcx-1 at 123\n");
        options.onOutput?.(
          "  worktree /tmp/w on ayo/fcx-1 at 123\n  executing\n",
        );
        await Promise.race([
          held,
          new Promise<void>((resolve) =>
            options.signal?.addEventListener("abort", () => resolve(), {
              once: true,
            }),
          ),
        ]);
        return { code: 0, stdout: "{}", stderr: "", cancelled: false };
      }
      return runProcess(binary, args, options);
    };
    const { service, repo, notifications, holds, changes, themes, setBattery } =
      fixture(runner);
    expect(themes).toEqual(["system"]);
    const registered = await service.registerRepository(repo);
    await finished(
      service,
      (await service.request({ kind: "admit", repoId: registered.id, draft }))
        .id,
    );
    const settings = SettingsSchema.parse({
      ...(await service.snapshot()).settings,
      notifyOn: { decision: true, review: true, ceiling: true, stage: true },
      notifySound: false,
      afk: { holdSleep: true, displaySleep: false, releaseOnBattery: true },
      theme: "dark",
    });
    await service.request({ kind: "saveSettings", settings });
    expect(themes.at(-1)).toBe("dark");
    const detail = await service.detail(registered.id, "FCX-1");
    const job = await service.request({
      kind: "run",
      repoId: registered.id,
      key: "FCX-1",
      digest: detail.digest,
      approve: true,
      publish: false,
      resumeFrom: null,
    });
    await vi.waitFor(() =>
      expect(holds.at(-1)).toEqual({ hold: true, displaySleep: false }),
    );
    expect((await service.snapshot()).power).toMatchObject({
      holding: true,
      detail: expect.stringContaining("FCX-1"),
    });
    expect(
      changes.some((change) => change.kind === "power" && change.power.holding),
    ).toBe(true);
    await vi.waitFor(() =>
      expect(notifications.map((entry) => entry.title)).toEqual([
        "FCX-1 · Materialising the worktree",
        "FCX-1 · Working on the approved outcome",
      ]),
    );
    expect(notifications[0]?.silent).toBe(true);
    setBattery(true);
    service.powerChanged();
    expect(holds.at(-1)).toEqual({ hold: false, displaySleep: false });
    expect((await service.snapshot()).power).toMatchObject({
      holding: false,
      detail: "Released on battery power.",
    });
    setBattery(false);
    service.powerChanged();
    expect(holds.at(-1)).toEqual({ hold: true, displaySleep: false });
    setTicketState(repo, "FCX-1", "changes_requested");
    release();
    await finished(service, job.id);
    await vi.waitFor(() =>
      expect(notifications.at(-1)).toEqual({
        title: "FCX-1 needs a decision",
        body: "The loop is paused until you answer.",
        silent: true,
      }),
    );
    expect(holds.at(-1)).toEqual({ hold: false, displaySleep: false });
    expect((await service.snapshot()).power).toEqual({
      holding: false,
      detail: null,
      since: null,
    });
  });

  it("keeps an older profile's single notification switch meaning what it said", async () => {
    const { service, options } = fixture();
    await service.shutdown();
    const profile = join(options.dataDirectory, "workspace.json");
    const stored = JSON.parse(readFileSync(profile, "utf8")) as {
      settings: Record<string, unknown>;
    };
    delete stored.settings["notifyOn"];
    stored.settings["notifications"] = false;
    writeFileSync(profile, JSON.stringify(stored));
    const restarted = new DesktopService(options);
    services.push(restarted);
    expect((await restarted.snapshot()).settings.notifyOn).toEqual({
      decision: false,
      review: false,
      ceiling: false,
      stage: false,
    });
  });

  it("deletes only a contract that has never run, and refuses one with evidence", async () => {
    const { service, repo } = fixture();
    const registered = await service.registerRepository(repo);
    await finished(
      service,
      (await service.request({ kind: "admit", repoId: registered.id, draft }))
        .id,
    );
    await finished(
      service,
      (
        await service.request({
          kind: "admit",
          repoId: registered.id,
          draft: { ...draft, outcome: "Second" },
        })
      ).id,
    );
    await service.request({
      kind: "rename",
      repoId: registered.id,
      key: "FCX-1",
      title: "Renamed",
    });
    const { ticket_id } = setTicketState(repo, "FCX-2", "plan_review");
    mkdirSync(join(repo, ".focrux", "state"), { recursive: true });
    writeFileSync(
      join(repo, ".focrux", "state", `${ticket_id}.attempts.json`),
      JSON.stringify({ ticket_id, attempts: [{ attempt_id: "att_1" }] }),
    );
    await expect(
      service.request({ kind: "discard", repoId: registered.id, key: "FCX-2" }),
    ).rejects.toThrow(/recorded attempts/);
    await service.request({
      kind: "discard",
      repoId: registered.id,
      key: "FCX-1",
    });
    const snapshot = await service.snapshot();
    expect(snapshot.tasks.map((row) => row.ticket.key)).toEqual(["FCX-2"]);
    expect(snapshot.titles).toEqual({});
    for (const suffix of [".json", ".contract.json", ".draft.json"])
      expect(
        existsSync(join(repo, ".focrux", "tickets", "FCX-1" + suffix)),
      ).toBe(false);
    await expect(
      service.request({ kind: "discard", repoId: registered.id, key: "FCX-1" }),
    ).rejects.toThrow(/no longer/);
  });

  it("opens the terminal on the provider's fixed sign-in command, and names the command where it cannot", async () => {
    const opened: string[][] = [];
    const { service, options } = fixture();
    options.io.openTerminal = async (command) => {
      opened.push([...command]);
    };
    await service.request({ kind: "login", provider: "claude" });
    await service.request({ kind: "login", provider: "codex" });
    expect(opened).toEqual([
      ["claude", "auth", "login"],
      ["codex", "login"],
    ]);
    delete options.io.openTerminal;
    await expect(
      service.request({ kind: "login", provider: "codex" }),
    ).rejects.toThrow(/Run codex login in your terminal/);
  });

  it("opens the worktree on the branch a ticket already has, whatever its key would derive", async () => {
    const { service, repo, root, options } = fixture();
    const registered = await service.registerRepository(repo);
    await finished(
      service,
      (await service.request({ kind: "admit", repoId: registered.id, draft }))
        .id,
    );
    // The branch the ticket's pull request is on: `ayo/`, which FCX-1's key
    // does not derive.
    const path = join(repo, ".focrux", "tickets", "FCX-1.json");
    const ticket = JSON.parse(readFileSync(path, "utf8")) as {
      ticket_id: string;
      delivery: { branch: string | null };
    };
    const recorded = `ayo/${ticket.ticket_id.replace(/^ticket_/, "")}/make-errors-actionable`;
    ticket.delivery.branch = recorded;
    writeFileSync(path, JSON.stringify(ticket, null, 2));
    const worktree = join(root, "worktree");
    execFileSync("git", ["worktree", "add", "-q", "-b", recorded, worktree], {
      cwd: repo,
      stdio: "ignore",
    });
    const opened: string[] = [];
    options.io.openPath = async (target) => {
      opened.push(target);
    };
    await service.request({
      kind: "openWorktree",
      repoId: registered.id,
      key: "FCX-1",
    });
    expect(opened).toEqual([realpathSync(worktree)]);
  });
});
