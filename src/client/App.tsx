import { useEffect, useMemo, useState } from "react";
import {
  api,
  type ConnectorStatus,
  type GuluPlan,
  type GuluSearchCampaign,
  type GuluTask,
  type JobChangeNote,
  type JobPack,
  type JobSummary,
  type ResultItem,
  type RunRecord,
} from "./api.js";
import { CampaignPanel } from "./CampaignPanel.js";
import "./styles.css";
import "./v12.css";
type View = "jobs" | "rules" | "run" | "results" | "settings";
const labels = { recommend: "推荐", review: "复核", exclude: "排除" } as const;
const split = (value: string) =>
  value
    .split(/[,，\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
const terminalTask = (status: string) =>
  ["completed", "stopped", "failed"].includes(status);
const roundSummary = (round: GuluPlan["rounds"][number]) =>
  Object.values(round.filters).flat().join("，") || "未设置标签";

export function App() {
  const [view, setView] = useState<View>("jobs"),
    [jobs, setJobs] = useState<JobSummary[]>([]),
    [archivedJobs, setArchivedJobs] = useState<JobSummary[]>([]),
    [selected, setSelected] = useState(""),
    [pack, setPack] = useState<JobPack | null>(null),
    [results, setResults] = useState<ResultItem[]>([]);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [title, setTitle] = useState("制造业销售经理"),
    [source, setSource] = useState(
      "寻找具备大型制造企业客户拓展经验，能够负责关键客户增长的销售经理。",
    ),
    [file, setFile] = useState<File | null>(null);
  const [demo, setDemo] = useState<RunRecord | null>(null),
    [connector, setConnector] = useState<ConnectorStatus | null>(null),
    [pairing, setPairing] = useState<{
      code: string;
      expiresAt: string;
    } | null>(null),
    [plan, setPlan] = useState<GuluPlan | null>(null),
    [task, setTask] = useState<GuluTask | null>(null);
  const [campaign, setCampaign] = useState<GuluSearchCampaign | null>(null);
  const [taskHistory, setTaskHistory] = useState<GuluTask[]>([]),
    [confirmFresh, setConfirmFresh] = useState(false),
    [archiveTarget, setArchiveTarget] = useState<JobSummary | null>(null),
    [resultsRunId, setResultsRunId] = useState("");
  const [changes, setChanges] = useState<JobChangeNote[]>([]),
    [changeText, setChangeText] = useState(""),
    [sourceNotes, setSourceNotes] = useState(""),
    [editingPlan, setEditingPlan] = useState(false);
  const [filter, setFilter] = useState("all"),
    [baseUrl, setBaseUrl] = useState("https://api.deepseek.com"),
    [model, setModel] = useState("deepseek-v4-flash");
  const refreshJobs = () =>
    Promise.all([api.jobs(), api.jobs(true)])
      .then(([active, archived]) => {
        setJobs(active.items);
        setArchivedJobs(archived.items);
      })
      .catch((e) => setNotice(e.message));
  const refreshConnector = () =>
    api
      .connectorStatus()
      .then(setConnector)
      .catch(() => setConnector(null));
  useEffect(() => {
    refreshJobs();
    refreshConnector();
    const timer = setInterval(refreshConnector, 10000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!task || terminalTask(task.status)) return;
    const timer = setInterval(
      () =>
        api
          .getRun<GuluTask>(task.id)
          .then((next) => {
            setTask(next);
            setTaskHistory((items) =>
              items.map((item) => (item.id === next.id ? next : item)),
            );
            if (next.campaignId)
              api
                .getRunStrategy(next.id)
                .then((strategy) => setCampaign(strategy.campaign))
                .catch(() => {});
            else if (next.status === "completed")
              api
                .getGuluPlan(next.jobId)
                .then(setPlan)
                .catch(() => {});
          })
          .catch(() => {}),
      2000,
    );
    return () => clearInterval(timer);
  }, [task?.id, task?.status]);
  const openJob = async (id: string, next: View = "rules") => {
    setBusy(true);
    try {
      const [data, savedPlan, changeData, runData] = await Promise.all([
        api.getJob(id),
        api.getGuluPlan(id).catch(() => null),
        api.listChanges(id),
        api.listGuluRuns(id),
      ]);
      const current =
        runData.items.find((item) => !terminalTask(item.status)) ??
        runData.items[0] ??
        null;
      setSelected(id);
      setPack(data.pack);
      setPlan(savedPlan);
      setSourceNotes(savedPlan?.sourceNotes || "");
      setChanges(changeData.items);
      setTaskHistory(runData.items);
      setEditingPlan(false);
      setTask(current);
      setCampaign(
        current?.campaignId
          ? ((await api.getRunStrategy(current.id).catch(() => null))
              ?.campaign ?? null)
          : null,
      );
      setResultsRunId(current?.id ?? "");
      setView(next);
      if (next === "results")
        setResults((await api.results(id, current?.id)).items);
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    setBusy(true);
    setNotice("DeepSeek 正在分析岗位要求，最长约 60 秒，请勿重复点击。");
    try {
      const created = file
        ? await api.importFile(title, file)
        : await api.create({ title, sourceText: source });
      setSelected(created.job_id);
      setPack(created);
      setChanges([]);
      setPlan(null);
      setCampaign(null);
      setTitle("");
      setSource("");
      setFile(null);
      setView("rules");
      setNotice("DeepSeek 已生成岗位草稿，请审核后批准。");
      await refreshJobs();
    } catch (e: any) {
      setNotice(
        e.message === "job_pack_generation_timeout"
          ? "DeepSeek 分析超过 60 秒，请重新生成"
          : "DeepSeek 未能生成有效岗位包，请检查连接后重试",
      );
    } finally {
      setBusy(false);
    }
  };
  const updateList = (key: string, value: string[]) =>
    setPack((p: any) => ({
      ...p,
      [key.split(".")[0]]: {
        ...p[key.split(".")[0]],
        [key.split(".")[1]]: value,
      },
    }));
  const save = async () => {
    if (!pack) return;
    setBusy(true);
    try {
      const next = await api.revise(selected, pack);
      setPack(next);
      setNotice(`已保存规则 v${next.rule_version}`);
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };
  const approve = async () => {
    if (!pack) return;
    setBusy(true);
    try {
      setPack(await api.approve(selected, pack.rule_version));
      setNotice("规则已批准，可以生成谷露搜索计划。");
      await refreshJobs();
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };
  const addChange = async () => {
    if (!changeText.trim()) return;
    setBusy(true);
    try {
      await api.createChange(selected, changeText);
      setChanges((await api.listChanges(selected)).items);
      setChangeText("");
      setNotice("岗位变化已保存，整合后会生成新规则版本。");
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };
  const integrateChanges = async () => {
    const ids = changes.filter((x) => !x.appliedRuleVersion).map((x) => x.id);
    if (!ids.length) return;
    setBusy(true);
    try {
      const next = await api.integrateChanges(selected, ids);
      setPack(next);
      setChanges((await api.listChanges(selected)).items);
      setPlan(null);
      setCampaign(null);
      setNotice(`岗位变化已整合为规则 v${next.rule_version}，请审核批准。`);
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };
  const generatePlan = async () => {
    setBusy(true);
    try {
      const next = await api.generateGuluPlan(selected);
      setPlan(next);
      setSourceNotes(next.sourceNotes);
      setNotice("DeepSeek 已生成两轮搜索条件，请人工确认。");
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };
  const importPlan = async () => {
    if (!sourceNotes.trim()) return;
    setBusy(true);
    try {
      setPlan(await api.importGuluPlan(selected, sourceNotes));
      setEditingPlan(false);
      setNotice("DeepSeek 已把同事方案整理为可编辑标签。");
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };
  const savePlanDraft = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      setPlan(await api.saveGuluPlanDraft(selected, plan));
      setEditingPlan(false);
      setNotice("修改已保存为待确认方案，需要重新 dry-run 和 5 人试跑。");
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };
  const confirmPlan = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      setPlan(await api.confirmGuluPlan(selected, plan));
      setEditingPlan(false);
      setNotice("搜索条件已人工确认。");
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };
  const startGulu = async (mode: GuluTask["mode"]) => {
    setBusy(true);
    try {
      const next = await api.startGulu(selected, mode);
      setTask(next);
      setTaskHistory((items) => [next, ...items]);
      setNotice(
        mode === "dry-run"
          ? "已创建只填写、不提交的 dry-run。"
          : mode === "pilot"
            ? "已创建真实 5 人试跑。"
            : "已创建正式双轮任务。",
      );
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };
  const startFresh = async () => {
    setBusy(true);
    try {
      const next = await api.startGulu(selected, "formal", true);
      setTask(next);
      setTaskHistory((items) => [next, ...items]);
      setResultsRunId(next.id);
      setConfirmFresh(false);
      setNotice(
        "新任务已开启：进度已归零，扩展将重置谷露筛选并从公司轮第 1 页开始。",
      );
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };
  const showRunResults = async (run: GuluTask) => {
    setBusy(true);
    try {
      setResults((await api.results(selected, run.id)).items);
      setResultsRunId(run.id);
      setView("results");
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };
  const archiveSelected = async () => {
    if (!archiveTarget) return;
    setBusy(true);
    try {
      await api.archiveJob(archiveTarget.id);
      if (selected === archiveTarget.id) {
        setSelected("");
        setPack(null);
        setPlan(null);
        setCampaign(null);
        setTask(null);
      }
      setArchiveTarget(null);
      await refreshJobs();
      setNotice("岗位已归档，可在“已归档岗位”中恢复。");
    } catch (e: any) {
      setNotice(
        e.message === "job_has_active_task"
          ? "请先停止当前任务，再归档岗位。"
          : e.message,
      );
    } finally {
      setBusy(false);
    }
  };
  const restoreArchived = async (job: JobSummary) => {
    setBusy(true);
    try {
      await api.restoreJob(job.id);
      await refreshJobs();
      setNotice("岗位已恢复。");
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };
  const activeTask = Boolean(task && !terminalTask(task.status));
  const shown = useMemo(
    () =>
      filter === "all" ? results : results.filter((x) => x.label === filter),
    [results, filter],
  );
  const nav = (id: View, text: string) => (
    <button
      className={view === id ? "nav active" : "nav"}
      onClick={() => setView(id)}
    >
      {text}
    </button>
  );
  return (
    <div className="app-shell">
      <aside>
        <div className="brand">
          <div className="logo">谷</div>
          <div>
            <strong>谷露简历筛选</strong>
            <small>DEEPSEEK · LOCAL</small>
          </div>
        </div>
        <div className="local-pill">
          <i />
          仅在本机运行
        </div>
        <nav>
          {nav("jobs", "岗位管理")}
          {nav("rules", "规则审核")}
          {nav("run", "运行中心")}
          {nav("results", "候选结果")}
          {nav("settings", "连接与设置")}
        </nav>
        <div className="safety">
          <b>安全边界</b>
          <p>只读筛选，不写入谷露</p>
          <p>最终决定由人工审核</p>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <p className="eyebrow">GULU SCREENING v1.3.0</p>
            <h1>
              {
                (
                  {
                    jobs: "岗位工作台",
                    rules: "规则审核",
                    run: "运行中心",
                    results: "候选结果",
                    settings: "连接与设置",
                  } as const
                )[view]
              }
            </h1>
          </div>
          <span className="shield">本机服务 · DeepSeek AI</span>
        </header>
        {notice && (
          <div className="notice" onClick={() => setNotice("")}>
            {notice}
            <span>×</span>
          </div>
        )}
        {busy && (
          <div className="progress">
            <i />
          </div>
        )}
        {view === "jobs" && (
          <section className="grid jobs-layout">
            <div className="panel create-card">
              <div className="panel-title">
                <span className="step">01</span>
                <div>
                  <h2>创建岗位</h2>
                  <p>粘贴需求，或上传 Word / PDF</p>
                </div>
              </div>
              <label>
                岗位名称
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                客户要求与 JD
                <textarea
                  rows={8}
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                />
              </label>
              <label className="upload">
                上传 DOCX / PDF / TXT
                <input
                  type="file"
                  accept=".docx,.pdf,.txt"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
                <span>{file?.name || "选择本机文件（最大 15MB）"}</span>
              </label>
              <button className="primary wide" onClick={create} disabled={busy}>
                {busy ? "DeepSeek 分析中…" : "生成岗位包 →"}
              </button>
            </div>
            <div className="panel">
              <div className="panel-title">
                <span className="step dark">02</span>
                <div>
                  <h2>岗位列表</h2>
                  <p>批准规则后才能连接真实谷露</p>
                </div>
              </div>
              <div className="job-list">
                {jobs.length ? (
                  jobs.map((j) => (
                    <JobListItem
                      key={j.id}
                      job={j}
                      onOpen={() => openJob(j.id)}
                      onAction={() => setArchiveTarget(j)}
                    />
                  ))
                ) : (
                  <Empty text="还没有岗位" />
                )}
              </div>
              <details className="archived-jobs">
                <summary>
                  已归档岗位 <span>{archivedJobs.length}</span>
                </summary>
                <div className="job-list">
                  {archivedJobs.length ? (
                    archivedJobs.map((j) => (
                      <JobListItem
                        key={j.id}
                        job={j}
                        onOpen={() => openJob(j.id)}
                        onAction={() => restoreArchived(j)}
                        archived
                      />
                    ))
                  ) : (
                    <p className="muted">没有已归档岗位。</p>
                  )}
                </div>
              </details>
            </div>
          </section>
        )}
        {view === "rules" && (
          <section>
            {!pack ? (
              <Empty text="请先选择岗位" />
            ) : (
              <>
                <div className="flow-head">
                  <div>
                    <span className={`status ${pack.approval.status}`}>
                      {pack.approval.status === "approved" ? "已批准" : "草稿"}
                    </span>
                    <h2>规则版本 v{pack.rule_version}</h2>
                  </div>
                  <div>
                    <a
                      className="button ghost"
                      href={`/api/jobs/${selected}/guide.docx`}
                    >
                      下载岗位说明
                    </a>
                  </div>
                </div>
                <div className="rules-grid">
                  <RuleList
                    title="硬条件"
                    value={pack.constraints.hard}
                    onChange={(v) => updateList("constraints.hard", v)}
                  />
                  <RuleList
                    title="加分项"
                    value={pack.constraints.soft}
                    onChange={(v) => updateList("constraints.soft", v)}
                  />
                  <RuleList
                    title="目标公司"
                    value={pack.companies.target}
                    onChange={(v) => updateList("companies.target", v)}
                  />
                  <RuleList
                    title="目标职位"
                    value={pack.roles.exact}
                    onChange={(v) => updateList("roles.exact", v)}
                  />
                  <RuleList
                    title="正面证据"
                    value={pack.evidence.required}
                    onChange={(v) => updateList("evidence.required", v)}
                  />
                  <RuleList
                    title="明确反证"
                    value={pack.evidence.negative}
                    onChange={(v) => updateList("evidence.negative", v)}
                  />
                </div>
                <JobChangesPanel
                  changes={changes}
                  text={changeText}
                  setText={setChangeText}
                  onSave={addChange}
                  onIntegrate={integrateChanges}
                />
                {task && task.ruleVersion !== pack.rule_version && (
                  <p className="notice">
                    当前任务继续使用规则 v{task.ruleVersion}；新规则 v
                    {pack.rule_version} 将用于下一次任务。
                  </p>
                )}
                <div className="action-bar">
                  <button className="ghost" onClick={save}>
                    保存新版本
                  </button>
                  <button
                    className="primary"
                    onClick={approve}
                    disabled={pack.approval.status === "approved"}
                  >
                    批准规则
                  </button>
                  <button
                    className="accent"
                    onClick={() => setView("run")}
                    disabled={pack.approval.status !== "approved"}
                  >
                    进入运行中心 →
                  </button>
                </div>
              </>
            )}
          </section>
        )}
        {view === "run" && (
          <section>
            {!selected ? (
              <Empty text="请先选择并批准一个岗位" />
            ) : (
              <div className="settings-grid">
                <div className="panel">
                  <div className="panel-title">
                    <span className="step">真</span>
                    <div>
                      <h2>真实谷露后台筛选</h2>
                      <p>网站可关闭；本机服务、Chrome 与登录需保持在线</p>
                    </div>
                  </div>
                  <CampaignPanel
                    jobId={selected}
                    approved={pack?.approval.status === "approved"}
                    sourceNotes={sourceNotes}
                    campaign={campaign}
                    onCampaign={setCampaign}
                    task={task}
                    onTask={(next) => {
                      setTask(next);
                      setTaskHistory((items) => [next, ...items]);
                      setResultsRunId(next.id);
                    }}
                    busy={busy}
                    setBusy={setBusy}
                    setNotice={setNotice}
                  />
                  <Connection status={connector} />
                  <details className="legacy-workflow">
                    <summary>旧版两轮诊断入口</summary>
                    <div className="rule-card source-notes">
                      <h3>粘贴同事搜索方案</h3>
                      <p>
                        支持自然语言、聊天记录或逐行内容，DeepSeek
                        会整理成下方标签。
                      </p>
                      <textarea
                        rows={5}
                        value={sourceNotes}
                        onChange={(e) => setSourceNotes(e.target.value)}
                        placeholder="例如：公司轮优先 Qupital、FundPark；岗位轮搜索 Relationship Manager…"
                      />
                      <button
                        className="accent"
                        onClick={importPlan}
                        disabled={
                          pack?.approval.status !== "approved" ||
                          !sourceNotes.trim()
                        }
                      >
                        DeepSeek 整理标签
                      </button>
                    </div>
                    {!plan ? (
                      <button
                        className="primary wide"
                        onClick={generatePlan}
                        disabled={pack?.approval.status !== "approved"}
                      >
                        用岗位规则生成搜索计划
                      </button>
                    ) : (
                      <PlanEditor
                        plan={plan}
                        onChange={setPlan}
                        editable={plan.status === "draft" || editingPlan}
                      />
                    )}{" "}
                    {plan && (
                      <div className="action-bar">
                        {plan.status === "draft" ? (
                          <button className="primary" onClick={confirmPlan}>
                            人工确认搜索条件
                          </button>
                        ) : editingPlan ? (
                          <button className="primary" onClick={savePlanDraft}>
                            保存为待确认方案
                          </button>
                        ) : (
                          <>
                            <button
                              className="ghost"
                              onClick={() => setEditingPlan(true)}
                            >
                              编辑搜索标签
                            </button>
                            <button
                              className="ghost"
                              onClick={() => startGulu("dry-run")}
                              disabled={activeTask}
                            >
                              只填写 dry-run
                            </button>
                            <button
                              className="accent"
                              onClick={() => startGulu("pilot")}
                              disabled={
                                !plan.rollout.dryRunCompleted || activeTask
                              }
                            >
                              真实 5 人试跑
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </details>
                  {task && !task.campaignId && (
                    <TaskProgress task={task} onUpdate={setTask} />
                  )}
                  <TaskHistory tasks={taskHistory} onResults={showRunResults} />
                </div>
                <div className="panel">
                  <div className="panel-title">
                    <span className="step dark">备</span>
                    <div>
                      <h2>离线模拟回退</h2>
                      <p>不操作真实谷露，可随时验证岗位规则</p>
                    </div>
                  </div>
                  {!demo ? (
                    <button
                      className="ghost wide"
                      onClick={async () => setDemo(await api.runDemo(selected))}
                    >
                      创建模拟运行
                    </button>
                  ) : (
                    <>
                      <p className="center">
                        {demo.cursor} / {demo.total} · {demo.status}
                      </p>
                      <div className="action-bar">
                        <button
                          className="ghost"
                          onClick={async () =>
                            setDemo(await api.processRun(demo.id, 5))
                          }
                        >
                          处理下一批
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </section>
        )}
        {view === "results" && (
          <Results
            selected={selected}
            items={results}
            shown={shown}
            filter={filter}
            setFilter={setFilter}
            runId={resultsRunId}
            reload={() =>
              selected &&
              api
                .results(selected, resultsRunId || undefined)
                .then((x) => setResults(x.items))
            }
          />
        )}
        {view === "settings" && (
          <section className="settings-grid">
            <div className="panel">
              <h2>谷露扩展配对</h2>
              <Connection status={connector} />
              <p>
                1. 在 Chrome 扩展页加载本项目的 <b>extension</b> 文件夹。
              </p>
              <p>2. 生成配对码，在扩展弹窗中输入。</p>
              {pairing ? (
                <div className="metric blue">
                  <small>10 分钟内有效的配对码</small>
                  <strong>{pairing.code}</strong>
                </div>
              ) : (
                <button
                  className="primary"
                  onClick={async () => setPairing(await api.createPairing())}
                >
                  生成一次性配对码
                </button>
              )}
            </div>
            <div className="panel">
              <h2>DeepSeek 连接</h2>
              <label>
                API 地址
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </label>
              <label>
                模型
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              </label>
              <button
                className="primary"
                onClick={async () => {
                  const r = await api.testDeepSeek(baseUrl, model);
                  setNotice(
                    r.ok ? `连接成功 · ${r.model}` : `连接失败：${r.errorType}`,
                  );
                }}
              >
                测试连接
              </button>
              <p className="muted">
                Key 只从本机 .env 读取，不显示、不写数据库。
              </p>
            </div>
          </section>
        )}
        {confirmFresh && plan && pack && (
          <NewTaskDialog
            pack={pack}
            plan={plan}
            onCancel={() => setConfirmFresh(false)}
            onConfirm={startFresh}
          />
        )}{" "}
        {archiveTarget && (
          <div
            className="dialog-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="归档岗位"
          >
            <div className="new-task-dialog archive-dialog">
              <h2>归档岗位</h2>
              <p>
                “{archiveTarget.title}
                ”将从默认列表隐藏，但规则、JD、历史任务和候选结果都会保留。
              </p>
              <div className="dialog-actions">
                <button
                  className="ghost"
                  onClick={() => setArchiveTarget(null)}
                >
                  取消
                </button>
                <button className="primary" onClick={archiveSelected}>
                  确认归档
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="empty large">
      ◇<br />
      {text}
    </div>
  );
}
function JobListItem({
  job,
  onOpen,
  onAction,
  archived = false,
}: {
  job: JobSummary;
  onOpen: () => void;
  onAction: () => void;
  archived?: boolean;
}) {
  return (
    <article className="job-row">
      <button className="job-open" onClick={onOpen}>
        <div>
          <b>{job.title}</b>
          <small>{new Date(job.created_at + "Z").toLocaleString()}</small>
        </div>
        <span className={`status ${job.status}`}>
          {job.status === "approved"
            ? "已批准"
            : `草稿 v${job.current_rule_version}`}
        </span>
        <em>›</em>
      </button>
      <button className="job-archive" onClick={onAction}>
        {archived ? "恢复岗位" : "归档岗位"}
      </button>
    </article>
  );
}
function RuleList({
  title,
  value,
  onChange,
}: {
  title: string;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="rule-card">
      <h3>{title}</h3>
      <p>每行一条，可人工修改</p>
      <textarea
        value={value.join("\n")}
        onChange={(e) => onChange(split(e.target.value))}
      />
    </div>
  );
}
function JobChangesPanel({
  changes,
  text,
  setText,
  onSave,
  onIntegrate,
}: {
  changes: JobChangeNote[];
  text: string;
  setText: (v: string) => void;
  onSave: () => void;
  onIntegrate: () => void;
}) {
  const pending = changes.filter((x) => !x.appliedRuleVersion);
  return (
    <div className="panel change-history">
      <div className="panel-title">
        <span className="step">变</span>
        <div>
          <h2>岗位变化</h2>
          <p>粘贴客户新反馈或随时间产生的要求；旧版本不会被覆盖。</p>
        </div>
      </div>
      <textarea
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="例如：客户新增要求、目标公司变化、必须经验调整…"
      />
      <div className="action-bar">
        <button className="ghost" onClick={onSave} disabled={!text.trim()}>
          保存变化
        </button>
        <button
          className="accent"
          onClick={onIntegrate}
          disabled={!pending.length}
        >
          整合 {pending.length || 0} 条变化为新版本
        </button>
      </div>
      {changes.length > 0 && (
        <div className="change-items">
          {changes.map((item) => (
            <div key={item.id}>
              <p>{item.text}</p>
              <small>
                {item.appliedRuleVersion
                  ? `已应用到规则 v${item.appliedRuleVersion}`
                  : "尚未整合"}{" "}
                ·{" "}
                {new Date(
                  item.createdAt.replace(" ", "T") + "Z",
                ).toLocaleString()}
              </small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function Connection({ status }: { status: ConnectorStatus | null }) {
  return (
    <div className="run-steps">
      <div>
        <b>{status?.paired ? "✓" : "1"}</b>
        <span>扩展{status?.paired ? "已配对" : "未配对"}</span>
      </div>
      <div>
        <b>{status?.extensionOnline ? "✓" : "2"}</b>
        <span>Chrome {status?.extensionOnline ? "在线" : "离线"}</span>
      </div>
      <div>
        <b>
          {status?.guluStatus === "online" || status?.guluStatus === "paired"
            ? "✓"
            : "3"}
        </b>
        <span>谷露 {status?.guluStatus || "待检查"}</span>
      </div>
    </div>
  );
}
function PlanEditor({
  plan,
  onChange,
  editable,
}: {
  plan: GuluPlan;
  onChange: (p: GuluPlan) => void;
  editable: boolean;
}) {
  const update = (
    index: number,
    key: keyof GuluPlan["rounds"][number]["filters"],
    value: string,
  ) => {
    const rounds = structuredClone(plan.rounds);
    rounds[index].filters[key] = split(value);
    onChange({ ...plan, rounds });
  };
  return (
    <div>
      <h3>
        搜索条件预览 · 方案 v{plan.version} ·{" "}
        {plan.status === "confirmed" ? "已确认" : "待确认"}
      </h3>
      {plan.rounds.map((round, index) => (
        <div className="rule-card" key={round.kind}>
          <h3>
            {round.kind === "company" ? "公司轮" : "岗位轮"} · 最多{" "}
            {round.limit} 人
          </h3>
          {(
            [
              "keywords",
              "companies",
              "roles",
              "cities",
              "industries",
              "functions",
            ] as const
          ).map((key) => (
            <label key={key}>
              {
                (
                  {
                    keywords: "关键词",
                    companies: "公司",
                    roles: "职位",
                    cities: "城市",
                    industries: "行业",
                    functions: "职能",
                  } as const
                )[key]
              }
              <input
                disabled={!editable}
                value={round.filters[key].join("，")}
                onChange={(e) => update(index, key, e.target.value)}
              />
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}
const roundLabel = (
  status: GuluTask["companyStatus"],
  round: "company" | "role",
  count: number,
) =>
  status === "empty"
    ? round === "role"
      ? "岗位轮已完成，没有匹配结果"
      : "公司轮已完成，没有匹配结果"
    : status === "completed"
      ? `${round === "company" ? "公司轮" : "岗位轮"}已读取 ${count} 人`
      : status === "running"
        ? `${round === "company" ? "公司轮" : "岗位轮"}正在读取`
        : status === "failed"
          ? `${round === "company" ? "公司轮" : "岗位轮"}异常`
          : `${round === "company" ? "公司轮" : "岗位轮"}等待开始`;
export function RoundProgress({ task }: { task: GuluTask }) {
  return (
    <div className="round-progress">
      <div className={`round-row ${task.companyStatus}`}>
        <b>公司轮进度</b>
        <span>
          {roundLabel(task.companyStatus, "company", task.companyReadCount)}
        </span>
      </div>
      <div className={`round-row ${task.roleStatus}`}>
        <b>岗位轮进度</b>
        <span>{roundLabel(task.roleStatus, "role", task.roleReadCount)}</span>
      </div>
    </div>
  );
}
function TaskProgress({
  task,
  onUpdate,
}: {
  task: GuluTask;
  onUpdate: (t: GuluTask) => void;
}) {
  return (
    <div className="rule-card">
      <h3>
        {task.mode} · {task.status} · 规则 v{task.ruleVersion} / 方案 v
        {task.planVersion}
      </h3>
      <RoundProgress task={task} />
      <p>
        当前第 {task.page} 页 · 累计读取 {task.readCount} · 去重{" "}
        {task.dedupedCount} · 已分析 {task.analyzedCount} · Token{" "}
        {task.inputTokens + task.outputTokens}
      </p>
      {task.lastError && <p className="notice">需要处理：{task.lastError}</p>}
      <div className="action-bar">
        {task.status === "running" || task.status === "queued" ? (
          <button
            className="ghost"
            onClick={async () =>
              onUpdate(await api.pauseRun<GuluTask>(task.id))
            }
          >
            暂停
          </button>
        ) : task.status === "paused" || task.status === "needs_attention" ? (
          <button
            className="ghost"
            onClick={async () =>
              onUpdate(await api.resumeRun<GuluTask>(task.id))
            }
          >
            恢复
          </button>
        ) : null}
        {!["completed", "stopped"].includes(task.status) && (
          <button
            className="primary"
            onClick={async () => onUpdate(await api.stopRun(task.id))}
          >
            紧急停止
          </button>
        )}
      </div>
    </div>
  );
}
function TaskHistory({
  tasks,
  onResults,
}: {
  tasks: GuluTask[];
  onResults: (task: GuluTask) => void;
}) {
  return (
    <details className="task-history">
      <summary>
        历史任务 <span>{tasks.length}</span>
      </summary>
      {tasks.length === 0 ? (
        <p className="muted">还没有真实谷露任务。</p>
      ) : (
        <div className="history-list">
          {tasks.map((item) => (
            <article key={item.id}>
              <div>
                <b>
                  {item.mode} · {item.status}
                </b>
                <small>
                  {item.createdAt
                    ? new Date(
                        item.createdAt.replace(" ", "T") + "Z",
                      ).toLocaleString()
                    : item.id.slice(0, 8)}
                </small>
              </div>
              <span>
                公司轮 {item.companyReadCount} · 岗位轮 {item.roleReadCount} ·
                已分析 {item.analyzedCount}
              </span>
              <button className="ghost" onClick={() => onResults(item)}>
                查看该任务结果
              </button>
            </article>
          ))}
        </div>
      )}
    </details>
  );
}
function NewTaskDialog({
  pack,
  plan,
  onCancel,
  onConfirm,
}: {
  pack: JobPack;
  plan: GuluPlan;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const company = plan.rounds.find((round) => round.kind === "company")!,
    role = plan.rounds.find((round) => round.kind === "role")!;
  return (
    <div
      className="dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="开启新任务"
    >
      <div className="new-task-dialog">
        <p className="eyebrow">FRESH FORMAL RUN</p>
        <h2>开启新任务</h2>
        <p>
          确认后将重置上次搜索残留，从公司轮第 1
          页开始。旧任务和结果会保留在历史中。
        </p>
        <dl>
          <div>
            <dt>规则版本</dt>
            <dd>v{pack.rule_version}</dd>
          </div>
          <div>
            <dt>搜索方案</dt>
            <dd>v{plan.version}</dd>
          </div>
          <div className="wide-row">
            <dt>岗位变化摘要</dt>
            <dd>{pack.summary || "无补充变化"}</dd>
          </div>
          <div className="wide-row">
            <dt>公司轮条件 · 最多 {company.limit} 人</dt>
            <dd>{roundSummary(company)}</dd>
          </div>
          <div className="wide-row">
            <dt>岗位轮条件 · 最多 {role.limit} 人</dt>
            <dd>{roundSummary(role)}</dd>
          </div>
        </dl>
        <div className="dialog-actions">
          <button className="ghost" onClick={onCancel}>
            返回修改
          </button>
          <button className="primary huge" onClick={onConfirm}>
            确认并开始正式任务
          </button>
        </div>
      </div>
    </div>
  );
}
function Results({
  selected,
  items,
  shown,
  filter,
  setFilter,
  runId,
  reload,
}: {
  selected: string;
  items: ResultItem[];
  shown: ResultItem[];
  filter: string;
  setFilter: (v: string) => void;
  runId: string;
  reload: () => void;
}) {
  if (!selected) return <Empty text="请先完成一次筛选" />;
  const counts = {
    recommend: items.filter((x) => x.label === "recommend").length,
    review: items.filter((x) => x.label === "review").length,
    exclude: items.filter((x) => x.label === "exclude").length,
  };
  return (
    <section>
      {runId && (
        <p className="result-scope">
          当前显示任务 {runId.slice(0, 8)} 的独立结果
        </p>
      )}
      <div className="metrics">
        <Metric label="全部" value={items.length} />
        <Metric label="推荐" value={counts.recommend} />
        <Metric label="复核" value={counts.review} />
        <Metric label="排除" value={counts.exclude} />
      </div>
      <div className="results-toolbar">
        <div className="filters">
          {[
            ["all", "全部"],
            ["recommend", "推荐"],
            ["review", "复核"],
            ["exclude", "排除"],
          ].map((x) => (
            <button
              key={x[0]}
              className={filter === x[0] ? "on" : ""}
              onClick={() => setFilter(x[0])}
            >
              {x[1]}
            </button>
          ))}
        </div>
        <div>
          <button className="ghost" onClick={reload}>
            刷新
          </button>
          <a
            className="button primary"
            href={`/api/jobs/${selected}/export.xlsx`}
          >
            导出 Excel
          </a>
        </div>
      </div>
      <div className="result-list">
        {shown.map((item) => (
          <ResultCard
            key={item.candidateId}
            item={item}
            jobId={selected}
            reload={reload}
          />
        ))}
      </div>
    </section>
  );
}
function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric blue">
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}
function ResultCard({
  item,
  jobId,
  reload,
}: {
  item: ResultItem;
  jobId: string;
  reload: () => void;
}) {
  const [note, setNote] = useState(item.note),
    [status, setStatus] = useState(item.reviewStatus);
  return (
    <article className="result-card">
      <div className={`label ${item.label}`}>{labels[item.label]}</div>
      <div className="person">
        <h3>{item.name}</h3>
        <p>
          {item.currentCompany} · {item.currentRole}
        </p>
      </div>
      <div className="evidence">
        <b>{item.reasonCode}</b>
        {item.evidence.map((x) => (
          <p key={x}>• {x}</p>
        ))}
      </div>
      <div className="review">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option>未审核</option>
          <option>已复核</option>
          <option>需沟通</option>
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="人工备注"
        />
        <button
          onClick={async () => {
            await api.review(
              jobId,
              item.candidateId,
              item.ruleVersion,
              status,
              note,
            );
            reload();
          }}
        >
          保存
        </button>
      </div>
    </article>
  );
}
