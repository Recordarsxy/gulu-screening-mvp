import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("section reset controls", () => {
  it("exposes reset and regeneration APIs", async () => {
    const source = await readFile(new URL("../src/client/api.ts", import.meta.url), "utf8");
    expect(source).toContain("resetSection");
    expect(source).toContain("/reset/${section}");
    expect(source).toContain("regenerateRules");
    expect(source).toContain("/rules/regenerate");
  });

  it("renders one confirmed reset control in each requested section", async () => {
    const source = await readFile(new URL("../src/client/App.tsx", import.meta.url), "utf8");
    for (const text of ["重置规则与全部下游数据", "重置运行中心", "清空候选结果", "重新生成规则"]) expect(source).toContain(text);
    expect(source).not.toContain("window.confirm");
    expect(source).toContain("resetTarget");
    expect(source).toContain("确认重置");
    expect(source).toContain("取消");
    expect(source).toContain('setResetTarget("rules")');
    expect(source).toContain('setResetTarget("runs")');
    expect(source).toContain('setResetTarget("results")');
    expect(source).toContain("api.regenerateRules(selected)");
  });

  it("clears only the affected client state after each reset", async () => {
    const source = await readFile(new URL("../src/client/App.tsx", import.meta.url), "utf8");
    expect(source).toContain('if (section === "rules")');
    expect(source).toContain('if (section === "runs")');
    expect(source).toContain("setPack(null)");
    expect(source).toContain("setTaskHistory([])");
    expect(source).toContain("setResults([])");
  });
});
