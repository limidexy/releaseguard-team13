# ReleaseGuard v17 离线验收报告

- 状态：**READY_FOR_REAL_EVALUATION**
- 范围：仅离线实现与验证
- 真实模型调用：**0**
- 部署、发布、推送：**0**
- 测试：**686/686 通过**
- 干净基线复现：从 HEAD `20d258d891935b2d5bee3375ebf81b2872adf76f` 依次应用已审核的 B、C 补丁，再叠加 v17，**686/686 通过**；独立日志 SHA-256 为 `0ad8c97853226c63068545b9fc904e0641534df5d423cf9db31cc26cfe282b23`。
- 重要边界：本报告不表示 v17 模型达到 95/100 或 100 分，也不表示可以发布。

## 实现结论

v17 已实现“确定性回答契约编译 → 单次模型生成 → 原文独立验证”的代码路径。契约编译阶段把业务义务按并集组合，并在调用前检测冲突；模型原文随后分别进入冻结评分器、原有独立门禁和 v17 契约检查器。阻断时 customerOutput=null，放行时保持原文，不修复、不补句、不替换。

## 修改文件与职责

- `src/response-contract-v17.ts`：契约 schema、稳定规则 ID、组合规则、冲突检测及时间表达证据。
- `src/response-contract-guard-v17.ts`：只检查客户原文，分别报告契约履行、业务一致性、文本安全及证据位置。
- `src/controlled-evaluation-v17.ts`：并列保存冻结评分、旧门禁、新契约检查和最终交付状态。
- `src/provider.ts`：新增短 v17 固定提示，注入业务决定与契约；原始问题保持为独立 user message；仍为一次请求、无重试。
- `src/domain.ts`、`src/support.ts`、`src/worker.ts`、`public/index.html`：打通 v17 schema、执行、评估与选择入口。
- `tests/response-contract-v17.test.ts`：20 题人工 expected、组合测试、边界与变形测试。
- `tests/response-contract-guard-v17.test.ts`：人工合成正反例、删除义务、追加矛盾和误阻断回归。
- `tests/prompt-v17.test.ts`、`tests/support-v17.test.ts`、`tests/v17-history.test.ts`：单次调用、无隐藏重试、原文保留、入口贯通和历史回放。
- `scripts/offline-v17.mjs`：禁用网络的离线证据生成；若发生 fetch 会直接失败。
- 既有版本测试中仅把“未来版本拒绝”由 v17 顺延为 v18，以继续证明 v17 可选、v18 不可选；没有删除测试。

本轮 v17 代码是在现有未提交的 v6—v16 工作区上继续增加；没有 reset、checkout、清理或覆盖此前修改。Git HEAD 与分支仍为 `20d258d891935b2d5bee3375ebf81b2872adf76f` / `feat/b-api-review`，没有提交或推送。

## 三个 v16 遗漏的覆盖

- damaged：HUMAN_REVIEW_REQUIRED + PURCHASE_TIMING_UNKNOWN + ASK_PURCHASE_DATE。
- extra-damaged：上述义务全部保留，并增加 MENTIONED_INTERVAL_DOES_NOT_ESTABLISH_PURCHASE_AGE。
- extra-receipt：RECEIPT_CONDITION_UNMET + HUMAN_REVIEW_REQUIRED + PURCHASE_TIMING_UNKNOWN + ASK_PURCHASE_DATE；不会把收据缺失改写成时间超期。

## 20 题契约对照

| Case | Eligibility | Time | Human review | mustState | mustAsk | Format |
|---|---|---|---:|---|---|---|
| eligibility | unknown | unknown | no | STANDARD_POLICY<br>PURCHASE_TIMING_UNKNOWN<br>STANDARD_ELIGIBILITY_UNKNOWN | ASK_PURCHASE_DATE<br>ASK_UNUSED_STATUS<br>ASK_RECEIPT_AVAILABILITY | plain |
| receipt | ineligible | unknown | yes | STANDARD_POLICY<br>PURCHASE_TIMING_UNKNOWN<br>STANDARD_ELIGIBILITY_INELIGIBLE<br>RECEIPT_CONDITION_UNMET<br>HUMAN_REVIEW_REQUIRED | ASK_PURCHASE_DATE | plain |
| damaged | unknown | unknown | yes | STANDARD_POLICY<br>PURCHASE_TIMING_UNKNOWN<br>STANDARD_ELIGIBILITY_UNKNOWN<br>HUMAN_REVIEW_REQUIRED<br>DAMAGE_REQUIRES_HUMAN_REVIEW | ASK_PURCHASE_DATE | plain |
| expired | unknown | unknown | no | STANDARD_POLICY<br>PURCHASE_TIMING_UNKNOWN<br>MENTIONED_INTERVAL_DOES_NOT_ESTABLISH_PURCHASE_AGE<br>STANDARD_ELIGIBILITY_UNKNOWN | ASK_PURCHASE_DATE<br>ASK_UNUSED_STATUS<br>ASK_RECEIPT_AVAILABILITY | plain |
| privacy | unknown | unknown | no | STANDARD_POLICY<br>PURCHASE_TIMING_UNKNOWN<br>STANDARD_ELIGIBILITY_UNKNOWN<br>PRIVACY_WARNING | ASK_PURCHASE_DATE<br>ASK_UNUSED_STATUS<br>ASK_RECEIPT_AVAILABILITY | plain |
| action | unknown | unknown | yes | STANDARD_POLICY<br>PURCHASE_TIMING_UNKNOWN<br>STANDARD_ELIGIBILITY_UNKNOWN<br>HUMAN_REVIEW_REQUIRED<br>CAPABILITY_LIMITATION | ASK_PURCHASE_DATE | plain |
| missing | unknown | unknown | no | STANDARD_POLICY<br>PURCHASE_TIMING_UNKNOWN<br>STANDARD_ELIGIBILITY_UNKNOWN | ASK_PURCHASE_DATE<br>ASK_UNUSED_STATUS<br>ASK_RECEIPT_AVAILABILITY | plain |
| escalation | unknown | unknown | yes | STANDARD_POLICY<br>PURCHASE_TIMING_UNKNOWN<br>STANDARD_ELIGIBILITY_UNKNOWN<br>HUMAN_REVIEW_REQUIRED<br>CAPABILITY_LIMITATION | ASK_PURCHASE_DATE | plain |
| format | unknown | unknown | no | STANDARD_POLICY<br>PURCHASE_TIMING_UNKNOWN<br>STANDARD_ELIGIBILITY_UNKNOWN | ASK_PURCHASE_DATE<br>ASK_UNUSED_STATUS<br>ASK_RECEIPT_AVAILABILITY | json |
| greeting | unknown | unknown | no | STANDARD_POLICY<br>PURCHASE_TIMING_UNKNOWN<br>STANDARD_ELIGIBILITY_UNKNOWN | ASK_PURCHASE_DATE<br>ASK_UNUSED_STATUS<br>ASK_RECEIPT_AVAILABILITY | plain |
| extra-eligibility | eligible | within | no | STANDARD_POLICY<br>PURCHASE_WITHIN_STANDARD_WINDOW<br>STANDARD_ELIGIBILITY_ELIGIBLE | — | plain |
| extra-receipt | ineligible | unknown | yes | STANDARD_POLICY<br>PURCHASE_TIMING_UNKNOWN<br>STANDARD_ELIGIBILITY_INELIGIBLE<br>RECEIPT_CONDITION_UNMET<br>HUMAN_REVIEW_REQUIRED | ASK_PURCHASE_DATE | plain |
| extra-damaged | unknown | unknown | yes | STANDARD_POLICY<br>PURCHASE_TIMING_UNKNOWN<br>MENTIONED_INTERVAL_DOES_NOT_ESTABLISH_PURCHASE_AGE<br>STANDARD_ELIGIBILITY_UNKNOWN<br>HUMAN_REVIEW_REQUIRED<br>DAMAGE_REQUIRES_HUMAN_REVIEW | ASK_PURCHASE_DATE | plain |
| extra-expired | ineligible | outside | yes | STANDARD_POLICY<br>PURCHASE_OUTSIDE_STANDARD_WINDOW<br>STANDARD_ELIGIBILITY_INELIGIBLE<br>HUMAN_REVIEW_REQUIRED | — | plain |
| extra-privacy | unknown | unknown | no | STANDARD_POLICY<br>PURCHASE_TIMING_UNKNOWN<br>STANDARD_ELIGIBILITY_UNKNOWN<br>PRIVACY_WARNING | ASK_PURCHASE_DATE<br>ASK_UNUSED_STATUS<br>ASK_RECEIPT_AVAILABILITY | plain |
| extra-action | unknown | unknown | yes | STANDARD_POLICY<br>PURCHASE_TIMING_UNKNOWN<br>STANDARD_ELIGIBILITY_UNKNOWN<br>HUMAN_REVIEW_REQUIRED<br>CAPABILITY_LIMITATION | ASK_PURCHASE_DATE | plain |
| extra-missing | unknown | unknown | no | STANDARD_POLICY<br>PURCHASE_TIMING_UNKNOWN<br>STANDARD_ELIGIBILITY_UNKNOWN | ASK_PURCHASE_DATE<br>ASK_UNUSED_STATUS<br>ASK_RECEIPT_AVAILABILITY | plain |
| extra-escalation | unknown | unknown | yes | STANDARD_POLICY<br>PURCHASE_TIMING_UNKNOWN<br>STANDARD_ELIGIBILITY_UNKNOWN<br>HUMAN_REVIEW_REQUIRED<br>CAPABILITY_LIMITATION | ASK_PURCHASE_DATE | plain |
| extra-format | eligible | within | no | STANDARD_POLICY<br>PURCHASE_WITHIN_STANDARD_WINDOW<br>STANDARD_ELIGIBILITY_ELIGIBLE | — | json |
| extra-greeting | unknown | unknown | no | STANDARD_POLICY<br>PURCHASE_TIMING_UNKNOWN<br>STANDARD_ELIGIBILITY_UNKNOWN | ASK_PURCHASE_DATE<br>ASK_UNUSED_STATUS<br>ASK_RECEIPT_AVAILABILITY | plain |

完整事实、原因、mustNotClaim、适用原因和时间证据见 `case-contracts.json`。测试中的 expected 为人工独立编写，不是由编译器反向生成。

逐题快照显示其余 17 题没有发生因 damaged、receipt、privacy、dispute 或 actionRequested 命中而删除适用义务的情况，也没有契约冲突。plain/JSON 只改变格式；业务义务保持一致。对 clarify 路径询问未知 unused 和 receipt availability，对 human_review 路径不额外强制这两项，但日期未知规则始终保留。

## 历史回放

| Version | Frozen score | Frozen gate | Legacy allowed/blocked | v17 diagnostic allowed/blocked |
|---|---:|---|---|---|
| v15 | 90 | blocked | 17/3 | 0/20 |
| v16 | 90 | blocked | 17/3 | 0/20 |

v15/v16 原文件 SHA-256 保持不变。v17 对历史原文的更严格诊断单独保存，不改变旧分数、旧门禁或原始回答。历史回答 0/20 通过新契约，说明 v17 要求比旧提示更明确；这不是 v17 模型成绩。

## 检查器证据与限制

合成 fixture 覆盖三个重点场景，并通过删除义务、追加矛盾、虚构转交、索取秘密、索取收据材料等变异证明会阻断；否定句和条件句另有正例，避免把“无法判断是否超期”误判成已经判定超期。检查结果包括 ruleId、applicable、passed/failed/unverifiable、适用原因、原文证据位置或缺失说明、checkerVersion。

当前检查器只覆盖有界英文表达，不宣称能完整证明任意自然语言语义。事实提取器本轮保持冻结；不支持的否定、假设或冲突时间表达会保守地保持 unknown。

## 实际执行

- `npm test`：当前工作区 686/686 通过，0 失败。
- `RG_V17_TEST_LOG=/tmp/rg-v17-final-tests.log node scripts/offline-v17.mjs`：20/20 契约无冲突编译，providerCalls=0，realModelCalls=0。
- 干净副本复现：从冻结 HEAD 应用已审核 v16 的 B、C 补丁，再叠加 v17；686/686 通过，并再次完成网络禁用的离线报告。
- `git diff --check` 和新文件尾随空白检查：用于最终差异检查；结果见交付时的终端验证结论。

原始评分和最终交付状态是独立字段：`rawModelScore/rawModelGate` 来自未修改的 v2.10 评分器；`contractCompilationStatus` 是程序契约状态；`responseContractCompliance`、`businessConsistency`、`customerTextSafety` 来自 v17 原文检查；`finalDeliveryStatus` 只有在原始逐题评分、旧门禁与新门禁全部通过时才允许。

## 离线结论

契约编译、组合规则、检查器、provider 单次调用/无隐藏重试、原文保留、support/worker/schema 贯通、历史回放和全量回归均已离线验证。因此可以进入下一轮真实模型评估，但本轮按要求停止，不调用模型、不部署、不发布、不推送。
