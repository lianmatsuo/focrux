import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { diagnose, verificationServiceNeed } from "../src/diagnostic.js";
import { makeRepo } from "./support.js";

/**
 * Materialization copies files. It cannot start a database.
 *
 * That is a real limit, and the failure mode it produces is the dangerous kind:
 * the suite runs, the tests that need the service error or skip, and the
 * attempt reports green with its verification unrun. These say so before the
 * attempt instead.
 */

function repoWith(scripts: Record<string, string>, extra: Record<string, unknown> = {}) {
  const repo = makeRepo();
  writeFileSync(
    join(repo.dir, "package.json"),
    JSON.stringify({ name: "x", scripts, ...extra }),
  );
  return repo;
}

describe("verificationServiceNeed", () => {
  it("refuses when the verification command itself starts a service", () => {
    // One repository, rewritten per case. `makeRepo` runs git, and four of them
    // for four readings of one `package.json` is four times the wall clock for
    // no more evidence — which is how a case like this comes to sit against the
    // default timeout on a loaded machine.
    const dir = repoWith({ test: "vitest run" }).dir;
    for (const script of [
      "docker compose up -d && vitest run",
      "docker-compose up -d db && jest",
      "pg_ctl start && pytest",
      "supabase start && vitest",
    ]) {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", scripts: { test: script } }));
      const need = verificationServiceNeed(dir, ["pnpm", "run", "test"]);
      expect(need?.severity, script).toBe("refusal");
    }
  });

  it("follows the pretest script, which is where the service usually starts", () => {
    const dir = repoWith({ pretest: "docker compose up -d", test: "vitest run" }).dir;
    expect(verificationServiceNeed(dir, ["pnpm", "run", "test"])?.severity).toBe("refusal");
  });

  it("warns, without refusing, when the repository declares services the command does not name", () => {
    const dir = repoWith({ test: "vitest run" }, { devDependencies: { testcontainers: "^10" } }).dir;
    const need = verificationServiceNeed(dir, ["pnpm", "run", "test"]);
    expect(need?.severity).toBe("advisory");
    expect(need?.reason).toBe("undeclared_service_dependency");
  });

  it("says nothing about a repository whose tests need nothing", () => {
    expect(verificationServiceNeed(repoWith({ test: "vitest run" }).dir, ["pnpm", "run", "test"])).toBeNull();
  });

  it("does not fire on a command that merely mentions a service in a flag", () => {
    // `--reporter=docker` is not starting anything. Substring matching on
    // "docker" would refuse this, and a false refusal is a repository nobody
    // can run.
    const dir = repoWith({ test: "vitest run --reporter=dockerish" }).dir;
    expect(verificationServiceNeed(dir, ["pnpm", "run", "test"])).toBeNull();
  });
});

describe("diagnose", () => {
  it("refuses a repository whose verification needs a service, before an attempt starts", async () => {
    const repo = repoWith({ test: "docker compose up -d && vitest run" });
    writeFileSync(join(repo.dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

    const result = await diagnose({ checkout: repo.dir, repository_id: "repo_fixture" });

    expect(result.materializable).toBe(false);
    const finding = result.findings.find((f) => f.reason === "verification_requires_service");
    expect(finding?.detail).toMatch(/docker compose/);
    // The point of refusing rather than reporting green.
    expect(finding?.detail).toMatch(/unrun|not run/);
  });
});
