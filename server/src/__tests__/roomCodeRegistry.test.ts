import { describe, it, expect, beforeEach } from "vitest";
import { generateCode, register, release, lookup, _resetForTest } from "../rooms/roomCodeRegistry.js";

describe("roomCodeRegistry", () => {
  beforeEach(() => _resetForTest());

  it("generates 6-char codes from the safe alphabet", () => {
    const c = generateCode();
    expect(c).toHaveLength(6);
    expect(c).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });

  it("register/lookup/release round-trip", () => {
    expect(lookup("ABCDEF")).toBeNull();
    expect(register("ABCDEF", "room-1")).toBe(true);
    expect(lookup("ABCDEF")).toBe("room-1");
    release("ABCDEF");
    expect(lookup("ABCDEF")).toBeNull();
  });

  it("register returns false on collision", () => {
    expect(register("ABCDEF", "room-1")).toBe(true);
    expect(register("ABCDEF", "room-2")).toBe(false);
    expect(lookup("ABCDEF")).toBe("room-1");
  });
});
