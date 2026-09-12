import { describe, expect, it, vi } from "vitest";

const hasCapture = vi.fn((id: string) => id === "evt_seen");
const addCapture = vi.fn();
vi.mock("../src/store.js", () => ({ hasCapture, addCapture, allCaptures: () => [] }));

const { capture } = await import("../src/capture.js");

describe("capture", () => {
  it("records a new capture", () => {
    expect(capture("evt_new", 100)).toEqual({ ok: true, deduped: false });
    expect(addCapture).toHaveBeenCalledTimes(1);
  });

  it("does not record a capture it has already seen", () => {
    addCapture.mockClear();
    expect(capture("evt_seen", 100)).toEqual({ ok: true, deduped: true });
    expect(addCapture).not.toHaveBeenCalled();
  });
});
