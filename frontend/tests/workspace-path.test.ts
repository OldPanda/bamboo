import { describe, expect, it } from "vitest";
import {
  workspaceContains,
  workspacePath,
  workspacePrefix,
  workspaceRelative,
} from "../src/workspace-path";

describe("native workspace paths", () => {
  it("keeps Windows nested paths and saved SQL keys consistent", () => {
    const root = "C:\\Data";
    const path = workspacePath(root, "nested/orders.parquet");
    expect(path).toBe("C:\\Data\\nested\\orders.parquet");
    expect(workspaceRelative(root, path)).toBe("nested/orders.parquet");
    expect(workspaceContains(root, path.toLowerCase())).toBe(true);
    expect(workspaceContains(root, "C:\\Database\\orders.parquet")).toBe(false);
    expect(workspacePrefix("C:\\")).toBe("C:\\");
    expect(workspacePath("\\\\server\\share", "nested/a.parquet")).toBe(
      "\\\\server\\share\\nested\\a.parquet",
    );
  });
  it("preserves Unix backslashes, case sensitivity and cloud identity", () => {
    expect(workspacePath("/data", "a\\b.parquet")).toBe("/data/a\\b.parquet");
    expect(workspaceRelative("/data", "/data/a\\b.parquet")).toBe(
      "a\\b.parquet",
    );
    expect(workspaceContains("/data", "/Data/a.parquet")).toBe(false);
    expect(workspacePath("r2://connection", "nested/a.parquet")).toBe(
      "r2://connection/nested/a.parquet",
    );
    expect(workspacePrefix("/")).toBe("/");
  });
});
