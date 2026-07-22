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

## Alternatives Rejected

- 硬编码行业/职能 ID：依赖谷露内部字典，字典变化后容易再次失效。
- 无法解析就跳过二级条件：会静默扩大结果集，违背已确认搜索条件。

## Verification

- JSDOM 回归测试覆盖空 `value` 的 `Gaming 游戏` 二级节点。
- 现有有值的城市树节点测试继续通过。
- 完整执行 typecheck、全部测试、build 和 lint。
- 使用同一 Meshy 岗位创建 fresh formal run，确认“游戏”可提交、URL 仍为 `savedSearchId=94096` 且无禁用 owner/contact 条件。
