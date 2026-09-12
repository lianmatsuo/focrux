import { afterEach, describe, expect, it, vi } from "vitest";
import { delimiter, join } from "node:path";
import {
  childEnvironment,
  forgetRegistryPath,
  installLocations,
  registryPath,
  searchPath,
} from "../src/host/process.js";

const windows = process.platform === "win32";
/** Two spellings of one Windows directory compare equal. */
const normalise = (entry: string): string =>
  entry.toLowerCase().replace(/[\\/]+$/, "");
afterEach(() => forgetRegistryPath());

describe("searchPath", () => {
  it("keeps the first source's ordering and drops later duplicates", () => {
    const merged = searchPath([
      ["/first", "/second"],
      ["/second", "/third"],
    ]).split(delimiter);
    expect(merged).toEqual(["/first", "/second", "/third"]);
  });

  it("drops empty entries and unwraps quoted ones", () => {
    expect(searchPath([["", "  ", '"/quoted"']]).split(delimiter)).toEqual([
      "/quoted",
    ]);
  });

  it.runIf(windows)(
    "treats Windows entries as the same directory whatever their case or trailing separator",
    () => {
      const merged = searchPath([
        ["C:\\Program Files\\GitHub CLI\\"],
        ["c:\\program files\\github cli"],
      ]).split(delimiter);
      expect(merged).toEqual(["C:\\Program Files\\GitHub CLI\\"]);
    },
  );
});

describe("installLocations", () => {
  it.runIf(windows)("names where the CLIs this app spawns install on Windows", () => {
    const found = installLocations(
      { ProgramFiles: "C:\\Program Files", APPDATA: "C:\\A", LOCALAPPDATA: "C:\\L" },
      "C:\\home",
    );
    expect(found).toContain(join("C:\\Program Files", "GitHub CLI"));
    expect(found).toContain(join("C:\\A", "npm"));
    expect(found).toContain(join("C:\\home", ".local", "bin"));
    expect(found).not.toContain("/opt/homebrew/bin");
  });

  it.runIf(!windows)("keeps the Homebrew and user prefixes a Finder launch misses", () => {
    const found = installLocations({}, "/home/one");
    expect(found).toEqual([
      "/home/one/.local/bin",
      "/opt/homebrew/bin",
      "/usr/local/bin",
    ]);
  });
});

describe("registryPath", () => {
  it.runIf(!windows)("asks nothing outside Windows", () => {
    expect(registryPath()).toEqual([]);
  });

  it.runIf(windows)("reads the machine and user PATH and expands what it stores", () => {
    const entries = registryPath();
    expect(entries.length).toBeGreaterThan(0);
    // REG_EXPAND_SZ keeps `%SystemRoot%\system32` unexpanded on disk; a child
    // process searching PATH cannot use it in that form.
    expect(entries.some((entry) => entry.includes("%"))).toBe(false);
    expect(
      entries.some((entry) => /windows[\\/]system32/i.test(entry)),
    ).toBe(true);
  });
});

describe("childEnvironment", () => {
  it("leaves exactly one spelling of PATH, which is what a child reads", () => {
    const env = childEnvironment();
    expect(Object.keys(env).filter((key) => /^path$/i.test(key))).toEqual([
      "PATH",
    ]);
  });

  it("puts the install locations ahead of the launch environment", () => {
    const entries = childEnvironment().PATH!.split(delimiter);
    expect(entries[0]).toBe(installLocations()[0]);
  });

  it("keeps every directory the app launched with", () => {
    const entries = new Set(
      childEnvironment()
        .PATH!.split(delimiter)
        .map((entry) => (windows ? entry.toLowerCase() : entry)),
    );
    for (const entry of (process.env.PATH ?? "").split(delimiter)) {
      if (!entry.trim()) continue;
      expect(entries.has(windows ? entry.toLowerCase() : entry)).toBe(true);
    }
  });

  it.runIf(windows)(
    "reaches a directory the registry gained after this process started",
    () => {
      // The bug this covers: an app launched from Explorer holds the PATH of
      // that moment, so a CLI installed afterwards — `gh`, and then a run that
      // publishes refuses to start — is invisible to every child it spawns
      // until the person signs out. Here the launch PATH is stripped back to
      // the one directory Windows always has, standing in for that snapshot.
      vi.stubEnv("PATH", "C:\\Windows\\system32");
      try {
        const entries = childEnvironment()
          .PATH!.split(delimiter)
          .map(normalise);
        const registry = registryPath();
        expect(registry.length).toBeGreaterThan(1);
        for (const entry of registry) expect(entries).toContain(normalise(entry));
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );

  it.runIf(windows)("reads one PATH however the launch environment spelled it", () => {
    // Explorer hands the app `Path`; reading `env.PATH` off the spread object
    // would miss it, and both keys reaching a child leaves the choice to spawn.
    const env = childEnvironment({ Path: "C:\\Only\\Here" });
    expect(Object.keys(env).filter((key) => /^path$/i.test(key))).toEqual([
      "PATH",
    ]);
    expect(env.PATH!.split(delimiter).map(normalise)).toContain(
      normalise("C:\\Only\\Here"),
    );
  });

  it("carries the extra entries and clears what Electron would leak", () => {
    const env = childEnvironment({ ELECTRON_RUN_AS_NODE: "1", MARK: "kept" });
    expect(env.MARK).toBe("kept");
    expect(env.NO_COLOR).toBe("1");
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
  });
});
