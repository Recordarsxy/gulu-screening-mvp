import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("Liepin-Codex job package UI", () => {
  it("exposes typed list, preview and idempotent import clients", async () => {
    const source = await readFile(
      new URL("../src/client/api.ts", import.meta.url),
      "utf8",
    );
    for (const name of [
      "LiepinJobPackSummary",
      "LiepinJobPackPreview",
      "listLiepinJobPacks",
      "getLiepinJobPack",
      "importLiepinJobPack",
    ])
      expect(source).toContain(name);
  });

  it("shows real Liepin packages with preview and import-and-open actions", async () => {
    const source = await readFile(
      new URL("../src/client/App.tsx", import.meta.url),
      "utf8",
    );
    for (const text of [
      "Liepin-Codex 岗位包",
      "刷新岗位包",
      "预览岗位包",
      "导入并打开规则审核",
      "正在读取 Liepin-Codex 岗位包",
      "正在把 Liepin-Codex 岗位包转换为谷露规则",
      "机器规则（job-rules.json）",
      "搜索计划（search-plan.json）",
      'JSON.stringify(liepinPreview.rules, null, 2)',
      'JSON.stringify(liepinPreview.searchPlan, null, 2)',
    ])
      expect(source).toContain(text);
    expect(source).toContain("liepinPacks.map");
    expect(source).toContain("api.importLiepinJobPack");
    expect(source).toContain("if (!(await openJob(imported.jobId))) return");
    expect(source).toContain("`liepin-preview-${item.id}`");
  });
});
