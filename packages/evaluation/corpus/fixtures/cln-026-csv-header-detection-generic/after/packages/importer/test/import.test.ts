import { describe, expect, it } from "vitest";
import { importCsv, namesEmailColumn } from "../src/import.js";

describe("header detection", () => {
  it.each([
    "Email",
    "e-mail",
    "E MAIL ADDRESS",
    "contact_email",
    "Work E-Mail",
    "MAIL",
    "EmailAddress",
    "MailAddress",
  ])("recognises %s as an email column", (header) => {
    expect(namesEmailColumn(header)).toBe(true);
  });

  it("does not mistake unrelated columns for the email one", () => {
    expect(namesEmailColumn("customer name")).toBe(false);
    expect(namesEmailColumn("mailing_list_opt_out_reason_code")).toBe(false);
    expect(namesEmailColumn("MailingList")).toBe(false);
  });

  it("selects the named column wherever it sits", () => {
    const result = importCsv("name,E-Mail\nAda,ada@example.test\nBen,ben@example.test");
    expect(result.imported).toEqual(["ada@example.test", "ben@example.test"]);
  });
});

describe("headerless files", () => {
  it("imports every row including the first", () => {
    const result = importCsv("Ada,ada@example.test\nBen,ben@example.test");
    expect(result.imported).toEqual(["ada@example.test", "ben@example.test"]);
    expect(result.rejected).toEqual([]);
  });

  it("still finds the column when the first row's email cell is malformed", () => {
    const result = importCsv("Ada,not-an-address\nBen,ben@example.test\nCy,cy@example.test");
    expect(result.imported).toEqual(["ben@example.test", "cy@example.test"]);
    expect(result.rejected).toEqual([{ row: 1, reason: 'not an email address: "not-an-address"' }]);
  });
});

describe("per-row rejection", () => {
  it("reports each bad row with its number and imports the rest", () => {
    const result = importCsv("email\nada@example.test\nnot-an-address\nben@example.test");
    expect(result.imported).toEqual(["ada@example.test", "ben@example.test"]);
    expect(result.rejected).toEqual([{ row: 3, reason: 'not an email address: "not-an-address"' }]);
  });

  it("numbers rejected rows by their line in the file, blank lines included", () => {
    const result = importCsv("email\nada@example.test\n\nnot-an-address\nben@example.test");
    expect(result.imported).toEqual(["ada@example.test", "ben@example.test"]);
    expect(result.rejected).toEqual([{ row: 4, reason: 'not an email address: "not-an-address"' }]);
  });

  it("reports a file with no findable email column instead of guessing", () => {
    const result = importCsv("name,age\nAda,36");
    expect(result.imported).toEqual([]);
    expect(result.rejected[0]?.reason).toContain("no email column");
  });
});

describe("quoted fields", () => {
  it("keeps a quoted comma inside its cell instead of shifting columns", () => {
    const result = importCsv('name,email\n"Doe, Jane",jane@example.test');
    expect(result.imported).toEqual(["jane@example.test"]);
    expect(result.rejected).toEqual([]);
  });

  it("reads an escaped quote as a literal quote", () => {
    const result = importCsv('name,email\n"the ""boss""",boss@example.test');
    expect(result.imported).toEqual(["boss@example.test"]);
  });
});
