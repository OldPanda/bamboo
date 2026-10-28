import { describe, it, expect } from "vitest";
import { snapBudget } from "../src/resource-slider";
describe("budget snapping", () => {
  it("snaps near marked values but allows intermediate drag values", () => {
    expect(snapBudget(8100, 128, 32768, [128, 4096, 8192, 16384, 32768])).toBe(
      8192,
    );
    expect(snapBudget(7000, 128, 32768, [128, 4096, 8192, 16384, 32768])).toBe(
      7000,
    );
    expect(snapBudget(15, 0, 64, [0, 4, 8, 16, 32, 48, 64])).toBe(16);
    expect(snapBudget(20, 0, 64, [0, 4, 8, 16, 32, 48, 64])).toBe(20);
    expect(snapBudget(128, 128, 32768, [128, 256, 512, 1024, 32768])).toBe(128);
    expect(snapBudget(320, 128, 32768, [128, 256, 512, 1024, 32768])).toBe(320);
  });
});
