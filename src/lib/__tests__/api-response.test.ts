import { describe, expect, it, vi } from "vitest";
import { INTERNAL_ERROR, logServerError, jsonError } from "@/lib/api-response";

describe("INTERNAL_ERROR", () => {
  it("returns a generic 500 with a safe, non-specific message", async () => {
    const res = INTERNAL_ERROR();
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe("Something went wrong. Please try again.");
  });

  it("never varies its message based on the underlying failure (it takes no arguments)", () => {
    // Structural guarantee: there is no way to pass a caught error's
    // message into this helper, so a call site can't accidentally leak
    // internals through it.
    expect(INTERNAL_ERROR.length).toBe(0);
  });
});

describe("logServerError", () => {
  it("logs a structured, prefixed message including the route and safe context", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    logServerError({ route: "materials/upload", op: "POST", userId: "user-1" }, new Error("db connection lost"));

    expect(spy).toHaveBeenCalledWith(
      "[api:materials/upload]",
      expect.objectContaining({ op: "POST", userId: "user-1", error: "db connection lost" })
    );

    spy.mockRestore();
  });

  it("stringifies a non-Error thrown value rather than dropping it", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    logServerError({ route: "x" }, "a plain string failure");

    expect(spy).toHaveBeenCalledWith("[api:x]", expect.objectContaining({ error: "a plain string failure" }));

    spy.mockRestore();
  });
});

describe("jsonError (existing behavior, unchanged)", () => {
  it("still merges extra fields alongside the message", async () => {
    const res = jsonError("nope", 409, { code: "CONFLICT_CODE" });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json).toEqual({ error: "nope", code: "CONFLICT_CODE" });
  });
});
