import { execFileSync, spawn } from "node:child_process";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";

export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
  cancelled: boolean;
}
export interface ProcessOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
  onOutput?: (text: string) => void;
  maxBytes?: number;
}

/**
 * A launch outside a terminal inherits a snapshot of an environment rather than
 * a shell's own: Finder passes almost no PATH, and on Windows the app holds the
 * PATH Explorer had when it started, so a CLI installed after that is invisible
 * until the person signs out. Both reach a person the same way — they have just
 * installed `gh`, and the run refuses to start because `gh` is not on PATH.
 *
 * These are the known install locations for the CLIs this app spawns. None of
 * them takes a value from a model or from repository content.
 */
export function installLocations(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): readonly string[] {
  if (process.platform !== "win32")
    return [join(home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];
  const programFiles = env.ProgramFiles ?? "C:\\Program Files";
  const appData = env.APPDATA ?? join(home, "AppData", "Roaming");
  const localAppData = env.LOCALAPPDATA ?? join(home, "AppData", "Local");
  return [
    join(home, ".local", "bin"),
    join(appData, "npm"),
    join(localAppData, "Microsoft", "WindowsApps"),
    join(programFiles, "GitHub CLI"),
    join(localAppData, "GitHub CLI"),
    join(programFiles, "nodejs"),
    join(programFiles, "Git", "cmd"),
  ];
}

/** `%SystemRoot%\\system32` as the registry stores it, against this process's own environment. */
function expand(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/%([^%]+)%/g, (whole, name: string) => {
    const found = Object.entries(env).find(
      ([key]) => key.toLowerCase() === name.toLowerCase(),
    );
    return found?.[1] ?? whole;
  });
}

const REGISTRY_PATH_KEYS = [
  "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
  "HKCU\\Environment",
] as const;
const REGISTRY_PATH_TTL_MS = 10_000;
let registryPathCache: { at: number; entries: readonly string[] } | null = null;

/**
 * The Windows PATH as the registry holds it *now*, which is how a `gh` or a
 * `node` installed since launch is found without restarting the app. Read at
 * most once every ten seconds: it is a synchronous spawn on the main process,
 * and a person who has just run an installer retries in seconds.
 *
 * Fixed argv against `reg`, and a hive that cannot be read leaves the launch
 * environment standing rather than failing the spawn it was collected for.
 */
export function registryPath(
  env: NodeJS.ProcessEnv = process.env,
): readonly string[] {
  if (process.platform !== "win32") return [];
  const now = Date.now();
  if (registryPathCache && now - registryPathCache.at < REGISTRY_PATH_TTL_MS)
    return registryPathCache.entries;
  const entries: string[] = [];
  for (const key of REGISTRY_PATH_KEYS) {
    try {
      const out = execFileSync("reg", ["query", key, "/v", "Path"], {
        encoding: "utf8",
        timeout: 5_000,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
      const value = /^\s*Path\s+REG(?:_EXPAND)?_SZ\s+(.*)$/im.exec(out)?.[1];
      if (value)
        entries.push(
          ...value
            .trim()
            .split(delimiter)
            .map((entry) => expand(entry, env)),
        );
    } catch {
      // No PATH from this hive. The launch environment still stands.
    }
  }
  registryPathCache = { at: now, entries };
  return entries;
}

/** Test seam: the next read goes to the registry rather than to the cache. */
export function forgetRegistryPath(): void {
  registryPathCache = null;
}

/**
 * The install locations first — they are what this app knows it needs, and the
 * reason this function exists — then the environment the app launched with, and
 * last whatever the registry has gained since. A later source never shadows an
 * earlier one, and a directory named by two of them appears once.
 */
export function searchPath(sources: readonly (readonly string[])[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const source of sources)
    for (const entry of source) {
      const value = entry.trim().replace(/^"(.*)"$/, "$1");
      if (!value) continue;
      const key =
        process.platform === "win32"
          ? value.toLowerCase().replace(/[\\/]+$/, "")
          : value;
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(value);
    }
  return parts.join(delimiter);
}

export function childEnvironment(
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  // Windows environment names are case-insensitive but object keys are not: an
  // app launched from Explorer carries `Path`, so reading `env.PATH` off the
  // spread misses it, and adding `PATH` beside it leaves which of the two the
  // child reads to the spawn implementation. Take every spelling, leave one.
  const launch: string[] = [];
  for (const key of Object.keys(env))
    if (/^path$/i.test(key)) {
      launch.push(...(env[key] ?? "").split(delimiter));
      delete env[key];
    }
  // The registry is expanded against this process's own environment, not the
  // copy above, whose PATH keys have just been taken out from under it.
  env.PATH = searchPath([installLocations(env), launch, registryPath()]);
  env.NO_COLOR = "1";
  env.FORCE_COLOR = "0";
  delete env.NODE_OPTIONS;
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

/** Logs are bounded and redact credentials inherited by this app, in addition to common token forms. */
export function redact(
  text: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  let result = text;
  for (const [name, value] of Object.entries(env)) {
    if (
      value &&
      value.length >= 8 &&
      /TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL/i.test(name)
    )
      result = result.split(value).join("[redacted]");
  }
  return result
    .replace(
      /\b(?:sk-ant-|sk-proj-|sk-|gh[pousr]_)[A-Za-z0-9_-]{12,}\b/g,
      "[redacted]",
    )
    .replace(
      new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[a-zA-Z]`, "g"),
      "",
    );
}

/** Fixed binary + argv only. Cancelling the process group reaches the CLI's provider children too. */
export function runProcess(
  binary: string,
  args: readonly string[],
  options: ProcessOptions,
): Promise<ProcessResult> {
  if (options.signal?.aborted)
    return Promise.resolve({
      code: 130,
      stdout: "",
      stderr: "Cancelled before starting",
      cancelled: true,
    });
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [...args], {
      cwd: options.cwd,
      env: options.env ?? childEnvironment(),
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      overflow = false,
      cancelled = false;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals): void => {
      if (child.pid === undefined) return;
      try {
        if (process.platform !== "win32") process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") reject(error);
      }
    };
    const stop = (): void => {
      cancelled = true;
      kill("SIGTERM");
      forceTimer ??= setTimeout(() => kill("SIGKILL"), 8000);
      forceTimer.unref();
    };
    const timeout = setTimeout(stop, options.timeoutMs ?? 60_000);
    const limit = options.maxBytes ?? 16 * 1024 * 1024;
    const receive = (chunk: Buffer, stream: "out" | "err"): void => {
      const value = chunk.toString("utf8");
      if (stdout.length + stderr.length + value.length > limit) {
        overflow = true;
        stop();
        return;
      }
      if (stream === "out") stdout += value;
      else {
        stderr += value;
        // Keep an unfinished line private: a credential may cross subprocess chunks.
        const complete = stderr.slice(0, stderr.lastIndexOf("\n") + 1);
        options.onOutput?.(redact(complete, options.env).slice(-80_000));
      }
    };
    child.stdout.on("data", (chunk: Buffer) => receive(chunk, "out"));
    child.stderr.on("data", (chunk: Buffer) => receive(chunk, "err"));
    options.signal?.addEventListener("abort", stop, { once: true });
    const cleanup = (): void => {
      clearTimeout(timeout);
      if (forceTimer) clearTimeout(forceTimer);
      options.signal?.removeEventListener("abort", stop);
    };
    child.once("error", (error) => {
      cleanup();
      reject(new Error(`Could not start ${binary}: ${error.message}`));
    });
    child.once("close", (code) => {
      cleanup();
      if (overflow)
        reject(
          new Error(
            "Command output exceeded the local capture limit. Open the CLI records to inspect this run.",
          ),
        );
      else
        resolve({
          code: code ?? 130,
          stdout: redact(stdout, options.env),
          stderr: redact(stderr, options.env),
          cancelled,
        });
    });
  });
}
