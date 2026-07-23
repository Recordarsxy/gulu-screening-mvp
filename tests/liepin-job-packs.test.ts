import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { openDatabase } from "../src/server/db/connection.js";
import { migrate } from "../src/server/db/migrate.js";
import { createApp } from "../src/server/app.js";
import { DeepSeekProvider } from "../src/server/services/deepseek.js";

describe("Liepin-Codex job package integration", () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function setup(options: { unsafePackage?: boolean } = {}) {
    const root = await mkdtemp(join(tmpdir(), "liepin-job-packs-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const packageRoot = join(root, "yibang-overseas-sales-shenzhen-20260715");
    await mkdir(join(packageRoot, "source"), { recursive: true });
    await writeFile(
      join(packageRoot, "job-rules.json"),
      JSON.stringify({
        schema_version: 1,
        job_id: "yibang-overseas-sales-shenzhen-20260715",
        rule_version: "1.1.0",
        approval: { status: "approved", approved_by: "user" },
        objective: "为亦邦在深圳寻找美国线和东南亚线国际物流销售。",
        role: { families: ["美国线国际物流销售", "东南亚线国际物流销售"] },
        experience: {
          required_patterns: ["美国线或东南亚线销售证据"],
          anti_signals: ["纯运营且无销售历史", "明确不满足大专学历"],
        },
        pending_client_questions: ["客户资源是否有最低业绩门槛？"],
      }),
      "utf8",
    );
    if (options.unsafePackage) {
      const outside = await mkdtemp(join(tmpdir(), "liepin-outside-"));
      cleanups.push(() => rm(outside, { recursive: true, force: true }));
      await writeFile(
        join(outside, "request.md"),
        "# secret outside the configured jobs root",
        "utf8",
      );
      const unsafeRoot = join(root, "unsafe-package");
      await mkdir(unsafeRoot, { recursive: true });
      await writeFile(
        join(unsafeRoot, "job-rules.json"),
        JSON.stringify({
          job_id: "unsafe-package",
          objective: "must never expose the linked source",
        }),
        "utf8",
      );
      await symlink(outside, join(unsafeRoot, "source"), "junction");
    }
    await writeFile(
      join(packageRoot, "search-plan.json"),
      JSON.stringify({ schema_version: 1, tasks: [{ value: "递四方" }] }),
      "utf8",
    );
    await writeFile(
      join(packageRoot, "human-brief.md"),
      "# 岗位快速理解手册\n\n需要国际物流销售经验。",
      "utf8",
    );
    await writeFile(
      join(packageRoot, "source", "request.md"),
      "# 用户需求\n\n- 客户/用人方：亦邦\n- 岗位：海外线路销售，深圳 base\n",
      "utf8",
    );
    await writeFile(
      join(packageRoot, "source", "jd.md"),
      "# 海外线路销售 JD\n\n负责美国线或东南亚线客户开发。",
      "utf8",
    );

    let generationCount = 0;
    const deepSeek = new DeepSeekProvider({
      apiKey: "test",
      fetcher: async (_url, init) => {
        generationCount += 1;
        const request = JSON.parse(String(init?.body ?? "{}"));
        const payload = JSON.parse(request.messages[1].content);
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    ...payload.template,
                    summary: "已从 Liepin-Codex 岗位包生成规则",
                    search_plan: [
                      ...payload.template.search_plan,
                      "公司轮：递四方",
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        );
      },
    });
    const db = openDatabase(":memory:");
    migrate(db);
    const app = createApp({
      db,
      dataRoot: root,
      deepSeek,
      liepinJobsRoot: root,
    });
    const http = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => http.once("listening", resolve));
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          http.close(() => {
            db.close();
            resolve();
          });
        }),
    );
    const port = (http.address() as AddressInfo).port;
    const request = async (path: string, init?: RequestInit) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        ...init,
        headers: {
          "content-type": "application/json",
          ...init?.headers,
        },
      });
      const body = await response.json().catch(() => null);
      return { status: response.status, data: body };
    };
    return { request, generationCount: () => generationCount };
  }

  it("lists and previews only complete job packages without exposing the absolute path", async () => {
    const { request } = await setup();
    const listed = await request("/api/integrations/liepin/job-packs");
    expect(listed).toMatchObject({
      status: 200,
      data: {
        configured: true,
        items: [
          {
            id: "yibang-overseas-sales-shenzhen-20260715",
            title: "海外线路销售，深圳 base",
            objective: "为亦邦在深圳寻找美国线和东南亚线国际物流销售。",
            approvalStatus: "approved",
            ruleVersion: "1.1.0",
          },
        ],
      },
    });
    expect(JSON.stringify(listed.data)).not.toContain(rootForAssertion(listed.data));

    const preview = await request(
      "/api/integrations/liepin/job-packs/yibang-overseas-sales-shenzhen-20260715",
    );
    expect(preview.status).toBe(200);
    expect(preview.data).toMatchObject({
      id: "yibang-overseas-sales-shenzhen-20260715",
      title: "海外线路销售，深圳 base",
      humanBrief: expect.stringContaining("岗位快速理解手册"),
      sourceText: expect.stringContaining("负责美国线或东南亚线客户开发"),
      rules: expect.objectContaining({
        objective: "为亦邦在深圳寻找美国线和东南亚线国际物流销售。",
      }),
      searchPlan: expect.objectContaining({ tasks: [{ value: "递四方" }] }),
    });
    expect(
      (
        await request(
          "/api/integrations/liepin/job-packs/%2E%2E%2Fsecret",
        )
      ).status,
    ).toBe(404);
  });

  it("imports a package once and reopens the existing Gulu job on duplicate import", async () => {
    const { request, generationCount } = await setup();
    const endpoint =
      "/api/integrations/liepin/job-packs/yibang-overseas-sales-shenzhen-20260715/import";
    const first = await request(endpoint, { method: "POST" });
    expect(first.status, JSON.stringify(first.data)).toBe(201);
    expect(first.data).toMatchObject({
      reused: false,
      pack: {
        approval: { status: "draft" },
        summary: "为亦邦在深圳寻找美国线和东南亚线国际物流销售。",
        roles: {
          exact: ["美国线国际物流销售", "东南亚线国际物流销售"],
        },
        companies: { target: [] },
        evidence: {
          required: ["美国线或东南亚线销售证据"],
          negative: ["纯运营且无销售历史"],
        },
        questions: [
          "客户资源是否有最低业绩门槛？",
          "请确认是否将“明确不满足大专学历”作为排除依据",
        ],
      },
    });
    const job = await request(`/api/jobs/${first.data.jobId}`);
    expect(job.data.job).toMatchObject({
      id: first.data.jobId,
      title: "海外线路销售，深圳 base",
    });
    expect(job.data.job.source_text).toContain("Liepin-Codex 岗位包");
    expect(job.data.job.source_text).toContain("递四方");

    const second = await request(endpoint, { method: "POST" });
    expect(second.status).toBe(200);
    expect(second.data).toMatchObject({
      reused: true,
      jobId: first.data.jobId,
    });
    expect(generationCount()).toBe(0);
  });

  it("hides packages whose nested source path escapes through a junction", async () => {
    const { request } = await setup({ unsafePackage: true });
    const listed = await request("/api/integrations/liepin/job-packs");
    expect(listed.status).toBe(200);
    expect(listed.data.items.map((item: { id: string }) => item.id)).toEqual([
      "yibang-overseas-sales-shenzhen-20260715",
    ]);
    const preview = await request(
      "/api/integrations/liepin/job-packs/unsafe-package",
    );
    expect(preview.status).toBe(404);
    expect(JSON.stringify(preview.data)).not.toContain("secret outside");
  });
});

function rootForAssertion(value: unknown) {
  const text = JSON.stringify(value);
  const match = text.match(/[A-Z]:\\\\[^"]+/i);
  return match?.[0] ?? "__no_absolute_path__";
}
