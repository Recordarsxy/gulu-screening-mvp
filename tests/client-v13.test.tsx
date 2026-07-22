import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
describe("v1.3 adaptive campaign UI", () => {
  it("exposes campaign generation, one-time confirmation and direct start APIs", async () => {
    const source = await readFile(
      new URL("../src/client/api.ts", import.meta.url),
      "utf8",
    );
    for (const text of [
      "generateCampaign",
      "saveCampaign",
      "confirmCampaign",
      "startCampaign",
      "getRunStrategy",
    ])
      expect(source).toContain(text);
  });
  it("shows editable strategy cards, budgets and dynamic step progress", async () => {
    const source = await readFile(
      new URL("../src/client/CampaignPanel.tsx", import.meta.url),
      "utf8",
    );
    for (const text of [
      "自适应搜索战役",
      "目标 shortlist",
      "总读取预算",
      "生成本次搜索策略",
      "确认搜索策略",
      "自动预检并开始任务",
      "搜索已穷尽",
      "高匹配",
      "单步预算",
      "手工追加一步",
      "暂停",
      "恢复",
      "紧急停止",
    ])
      expect(source).toContain(text);
    expect(source).toContain("campaign.steps.map");
    expect(source).toContain("task.stepProgress.map");
  });
  it("uses campaign workflow in the run center and identifies v1.3", async () => {
    const source = await readFile(
      new URL("../src/client/App.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("<CampaignPanel");
    expect(source).toContain("GULU SCREENING v1.3.0");
  });
});
