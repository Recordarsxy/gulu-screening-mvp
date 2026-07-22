import {
  api,
  type GuluFilters,
  type GuluSearchCampaign,
  type GuluSearchStep,
  type GuluTask,
} from "./api.js";

const fields: Array<keyof GuluFilters> = [
  "keywords",
  "companies",
  "roles",
  "cities",
  "industries",
  "functions",
];
const labels: Record<keyof GuluFilters, string> = {
  keywords: "关键词",
  companies: "公司",
  roles: "职位",
  cities: "城市",
  industries: "行业",
  functions: "职能",
};
const split = (value: string) =>
  value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

export function CampaignPanel({
  jobId,
  approved,
  sourceNotes,
  campaign,
  onCampaign,
  task,
  onTask,
  busy,
  setBusy,
  setNotice,
}: {
  jobId: string;
  approved: boolean;
  sourceNotes: string;
  campaign: GuluSearchCampaign | null;
  onCampaign: (campaign: GuluSearchCampaign | null) => void;
  task: GuluTask | null;
  onTask: (task: GuluTask) => void;
  busy: boolean;
  setBusy: (value: boolean) => void;
  setNotice: (value: string) => void;
}) {
  const action = async <T,>(
    work: () => Promise<T>,
    done: (value: T) => void,
    message: string,
  ) => {
    setBusy(true);
    try {
      const value = await work();
      done(value);
      setNotice(message);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  const generate = () =>
    action(
      () => api.generateCampaign(jobId, sourceNotes),
      onCampaign,
      "DeepSeek 已生成本次岗位专属搜索战役，请确认步骤。",
    );
  const updateStep = (index: number, key: keyof GuluFilters, value: string) => {
    if (!campaign) return;
    const steps = structuredClone(campaign.steps);
    steps[index].filters[key] = split(value);
    onCampaign({ ...campaign, status: "draft", confirmedAt: null, steps });
  };
  const move = (index: number, direction: -1 | 1) => {
    if (!campaign) return;
    const target = index + direction;
    if (target < 0 || target >= campaign.steps.length) return;
    const steps = structuredClone(campaign.steps);
    [steps[index], steps[target]] = [steps[target], steps[index]];
    steps.forEach((step, order) => (step.order = order));
    onCampaign({ ...campaign, status: "draft", confirmedAt: null, steps });
  };
  const updateLimit = (index: number, value: number) => {
    if (!campaign) return;
    const steps = structuredClone(campaign.steps);
    steps[index].limit = Math.max(5, Math.min(40, value || 5));
    onCampaign({ ...campaign, status: "draft", confirmedAt: null, steps });
  };
  const appendManualStep = () => {
    if (!campaign || campaign.steps.length >= campaign.maxSteps) return;
    const used = campaign.steps.reduce((sum, step) => sum + step.limit, 0);
    const remaining = campaign.maxUniqueCandidates - used;
    if (remaining < 5) {
      setNotice("总预算已用完，请先降低其他步骤的单步预算。");
      return;
    }
    const step: GuluSearchStep = {
      id: crypto.randomUUID(),
      order: campaign.steps.length,
      type: "manual",
      title: "手工搜索方向",
      objective: "补充用户确认的搜索方向",
      rationale: "由用户在任务开始前追加并确认。",
      expectedSignals: [],
      limit: Math.min(20, remaining),
      enabled: true,
      filters: {
        keywords: [],
        companies: [],
        roles: [],
        cities: [],
        industries: [],
        functions: [],
      },
      sources: [],
    };
    onCampaign({
      ...campaign,
      status: "draft",
      confirmedAt: null,
      steps: [...campaign.steps, step],
    });
  };
  const save = () =>
    campaign &&
    action(
      () => api.saveCampaign(jobId, campaign),
      onCampaign,
      "搜索策略草稿已保存。",
    );
  const confirm = () =>
    campaign &&
    action(
      () => api.confirmCampaign(jobId, campaign),
      onCampaign,
      "搜索策略已确认，只需确认这一次。",
    );
  const start = () =>
    campaign &&
    action(
      () => api.startCampaign(jobId, campaign.id),
      onTask,
      "任务已开始：系统将自动预检、首批校准并继续正式搜索。",
    );
  return (
    <section className="campaign-panel">
      <div className="campaign-title">
        <div>
          <p className="eyebrow">V1.3 SEARCH CAMPAIGN</p>
          <h2>自适应搜索战役</h2>
          <p>每个任务重新生成策略；不再强制公司轮和岗位轮。</p>
        </div>
        {!campaign && (
          <button
            className="primary"
            disabled={!approved || busy}
            onClick={generate}
          >
            生成本次搜索策略
          </button>
        )}
      </div>
      {campaign && (
        <>
          <div className="campaign-metrics">
            <div>
              <small>目标 shortlist</small>
              <input
                type="number"
                min={5}
                max={15}
                disabled={campaign.status === "confirmed"}
                value={campaign.targetShortlist}
                onChange={(event) =>
                  onCampaign({
                    ...campaign,
                    targetShortlist: Number(event.target.value),
                    status: "draft",
                  })
                }
              />
            </div>
            <div>
              <small>总读取预算</small>
              <strong>{campaign.maxUniqueCandidates}</strong>
            </div>
            <div>
              <small>搜索步骤</small>
              <strong>
                {campaign.steps.filter((step) => step.enabled).length}
              </strong>
            </div>
            <div>
              <small>状态</small>
              <strong>
                {campaign.status === "confirmed" ? "已确认" : "待确认"}
              </strong>
            </div>
          </div>
          <p className="campaign-summary">{campaign.summary}</p>
          <div className="campaign-steps">
            {campaign.steps.map((step, index) => (
              <article
                className={`campaign-step ${step.enabled ? "" : "disabled"}`}
                key={step.id}
              >
                <header>
                  <span>{index + 1}</span>
                  <div>
                    <input
                      className="step-title-input"
                      disabled={campaign.status === "confirmed"}
                      value={step.title}
                      onChange={(event) => {
                        const steps = structuredClone(campaign.steps);
                        steps[index].title = event.target.value;
                        onCampaign({ ...campaign, status: "draft", steps });
                      }}
                    />
                    <small>
                      {step.type} · 最多 {step.limit} 人
                    </small>
                    <label className="step-budget">
                      单步预算
                      <input
                        type="number"
                        min={5}
                        max={40}
                        disabled={campaign.status === "confirmed"}
                        value={step.limit}
                        onChange={(event) =>
                          updateLimit(index, Number(event.target.value))
                        }
                      />
                    </label>
                  </div>
                  <div className="step-actions">
                    <button
                      disabled={campaign.status === "confirmed"}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      disabled={campaign.status === "confirmed"}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </button>
                    <label>
                      <input
                        type="checkbox"
                        disabled={campaign.status === "confirmed"}
                        checked={step.enabled}
                        onChange={(event) => {
                          const steps = structuredClone(campaign.steps);
                          steps[index].enabled = event.target.checked;
                          onCampaign({ ...campaign, status: "draft", steps });
                        }}
                      />
                      启用
                    </label>
                  </div>
                </header>
                <p>{step.rationale}</p>
                <div className="step-filters">
                  {fields.map((field) => (
                    <label key={field}>
                      {labels[field]}
                      <input
                        disabled={campaign.status === "confirmed"}
                        value={step.filters[field].join("，")}
                        onChange={(event) =>
                          updateStep(index, field, event.target.value)
                        }
                      />
                    </label>
                  ))}
                </div>
              </article>
            ))}
          </div>
          <div className="action-bar">
            {campaign.status === "draft" ? (
              <>
                <button
                  className="ghost"
                  disabled={campaign.steps.length >= campaign.maxSteps}
                  onClick={appendManualStep}
                >
                  手工追加一步
                </button>
                <button className="ghost" onClick={save}>
                  保存策略
                </button>
                <button className="primary" onClick={confirm}>
                  确认搜索策略
                </button>
              </>
            ) : (
              <button
                className="accent huge"
                disabled={Boolean(
                  task &&
                  !["completed", "stopped", "failed"].includes(task.status),
                )}
                onClick={start}
              >
                自动预检并开始任务
              </button>
            )}
          </div>
        </>
      )}
      {task?.campaignId && (
        <div className="campaign-progress">
          <h3>步骤执行时间线</h3>
          <p>
            阶段：{task.phase} · 已读取 {task.readCount} · 高匹配{" "}
            {task.shortlistedCount}/{campaign?.targetShortlist ?? 10}
          </p>
          <div className="action-bar">
            {["queued", "running"].includes(task.status) && (
              <button
                className="ghost"
                disabled={busy}
                onClick={() =>
                  action(
                    () => api.pauseRun<GuluTask>(task.id),
                    onTask,
                    "任务已暂停。",
                  )
                }
              >
                暂停
              </button>
            )}
            {["paused", "needs_attention"].includes(task.status) && (
              <button
                className="ghost"
                disabled={busy}
                onClick={() =>
                  action(
                    () => api.resumeRun<GuluTask>(task.id),
                    onTask,
                    "任务已恢复。",
                  )
                }
              >
                恢复
              </button>
            )}
            {!["completed", "stopped", "failed"].includes(task.status) && (
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  action(() => api.stopRun(task.id), onTask, "任务已紧急停止。")
                }
              >
                紧急停止
              </button>
            )}
          </div>
          {task.stepProgress.map((progress, index) => (
            <div
              className={`campaign-progress-row ${progress.status}`}
              key={progress.stepId}
            >
              <b>{index + 1}</b>
              <span>
                {campaign?.steps.find((step) => step.id === progress.stepId)
                  ?.title ?? progress.stepId}
              </span>
              <em>
                {progress.status} · 读取 {progress.readCount} · 去重{" "}
                {progress.uniqueCount} · 高匹配 {progress.highFitCount}
              </em>
            </div>
          ))}
          {task.completionReason && (
            <div className="campaign-report">
              <b>
                {task.completionReason === "search_exhausted"
                  ? "搜索已穷尽"
                  : "任务已完成"}
              </b>
              <p>
                有效 shortlist {task.shortlistedCount}{" "}
                人；系统已保存步骤覆盖、停止原因和策略调整记录。
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
