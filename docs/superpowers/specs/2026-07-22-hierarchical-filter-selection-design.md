# Hierarchical Filter Selection Design

## Problem

谷露的行业、职能等筛选项使用树形控件。搜索“游戏”后，页面返回二级节点 `Gaming 游戏`，但该节点 checkbox 的 HTML `value` 是空字符串。现有适配器要求 checkbox 必须有非空 `value` 才能被选中，因此在点击前报错 `filter_value_unresolved:industries:游戏`，任务进入 `needs_attention`。

## Evidence

- 实时连接错误：`filter_value_unresolved:industries:游戏`。
- 运行 `c9d6a136-ddf2-490d-9b10-acde972802ab` 在 `海外销售 + 游戏` 方向中断，候选读取数为 0。
- 真实 DOM 中可见节点为 `Gaming 游戏`、`aria-level=2`，其 checkbox 为 `<input type="checkbox" value="">`。

## Chosen Design

1. 树形节点仍按可见文字匹配，精确文字优先，其次选更浅的层级。
2. 只要匹配节点存在 checkbox 就允许点击，不再要求 checkbox 的 HTML `value` 非空。该 `value` 不是谷露树控件的稳定节点标识。
3. 点击“确认”后必须验证控件已选文字不再是“请选择”，或隐藏提交值已变为非空。验证失败仍明确报 `filter_value_unresolved`。
4. 不硬编码“游戏”的内部 ID，不跳过业务要求的行业条件，不改变 1–100 人读取窗口。

## Missing Taxonomy Values

真实验证又发现，DeepSeek 生成的 `3D打印`、`消费电子`、`AR/VR` 不一定是谷露树形字典中可选的节点。这与“节点存在但提交失败”是两类问题：

- 搜索后没有任何匹配节点：返回 `filter_value_not_found`，记录当前组合和不可用标签，自动切换下一搜索方向。
- 树搜索结果是异步渲染的：分类为缺失前最多等待 1.2 秒，并将“看似缺失”与 `unresolved` 一样交给 MAIN world 二次确认。这防止有效节点如“游戏”因加载窗口被误跳过。
- 存在匹配节点但点击、确认或提交无法验证：仍返回 `filter_value_unresolved` 并暂停，避免静默放宽筛选。
- 不可用标签不冒充真实的“0 个候选人”；策略记录中的 `resultCount` 为 `null`，并保留字段与标签值证据。

## Detail Privacy Boundary

真实候选人页的工作描述 DOM 可能夹带联系方式区块。因此联系信息防护采用两层边界：

- 扩展在返回详情快照前就移除手机、邮箱、微信/WebChat 和地址文本。
- 本机服务在记录任务事件、快照或候选人前再做一次相同类型的清洗，防止 DOM 变化穿透第一层。

## Chrome Execution Boundary

真实页面进一步证实 jqTree 的业务选择事件在页面主环境中：真实点击 `Gaming 游戏` 会写入行业 ID `2201`，但 content script 隔离环境的合成点击不会触发该处理。因此：

- 普通标签仍全部在 content script 中处理。
- 只有 `cities` / `industries` / `functions` 已明确返回 `filter_value_unresolved` 时，后台才用 Chrome `MAIN` world 执行同一可见节点点击。
- MAIN-world 函数仅能在三个已批准树字段内定位节点、确认并点击“添加”；它不读候选人资料，不接受 owner/type 字段，也不执行谷露写操作。

## Alternatives Rejected

- 硬编码行业/职能 ID：依赖谷露内部字典，字典变化后容易再次失效。
- 无法解析就跳过二级条件：会静默扩大结果集，违背已确认搜索条件。

## Verification

- JSDOM 回归测试覆盖空 `value` 的 `Gaming 游戏` 二级节点。
- 现有有值的城市树节点测试继续通过。
- 完整执行 typecheck、全部测试、build 和 lint。
- 使用同一 Meshy 岗位创建 fresh formal run，确认“游戏”可提交、URL 仍为 `savedSearchId=94096` 且无禁用 owner/contact 条件。
