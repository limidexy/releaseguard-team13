C — LIN XINDA · 模型适配、Prompt、用例与评价
交接 / 离线复核记录：2026-10-13（新加坡）

来源与职责
这份目录整理 C 负责的现有代码与本次实际离线复核。基线源 commit 为 e94d4f1c1b438a90551c18f832c7844e1a822df2。
该基线已经在 feat/local-course-evidence，不重复导入或改变已有 Git 作者。这个新分支没有修改业务源码、prompt、评分规则或模型输出。
本次整理、命令执行、测试和提交由 Codex 依用户授权完成并标为 AI-assisted，不代表 LIN XINDA 或其他成员已亲自做过独立人工评分、UAT 或代码审核。

负责的代码（以下路径均相对于仓库根目录）
- src/provider.ts：v1/v2 prompt、哈希、输出预算、HTTPS 适配、结束原因和用量。
- src/support.ts：replay / real 执行入口、真实请求间隔。
- src/returns-policy.ts：版本化规则；旧 v2.0 和新 v2.1 分开保留。
- public/demo-fixtures.json、scripts/fixtures.mjs：共享十用例和静态回放。
- scripts/compare-prompts.mjs：两版比较驱动。
- scripts/rescore-retained.mjs：保留回答的离线复核。
- scripts/provider-smoke.mjs：单次真实调用驱动，需要单独确认；本次没有执行。
- scripts/cloud-rescore-retained.mjs：云端 imported 复核，需要云授权；本次没有执行。
- docs/human-rubric.csv：独立人工评分模板，目前不由 AI 代填。
相关测试：tests/provider.test.ts、tests/returns-policy.test.ts（与 E 协作）；共享契约 src/domain.ts 和恢复逻辑 src/worker.ts（与 B 协作）。

本次实际执行与证据
证据目录：docs/evidence/2026-10-13-c-offline/
verification.json 保留执行时间、源 commit、Node 版本、命令、退出码和未验证范围。
unit-tests.log：TypeScript 编译及 138 项测试通过；image-identity.log：另 1 项测试通过。
retained-offline-rescore.log 与 rescore-retained-1791860411412.json：同批原始回答的离线重算，零模型调用。
以上是 2026-10-13 11:00 左右新加坡时间在干净本地克隆的实际运行，不是云端 CI/CD、人工审核或新模型实验。

如何复现 C 的离线检查
从完整 Git 克隆根目录执行（Node.js 24+）：
npm ci --no-audit --no-fund
npm run build
node --test dist/tests/provider.test.js dist/tests/returns-policy.test.js
node scripts/rescore-retained.mjs docs/evidence/cloud-2026-10-11-retest/prompt-comparison-real-1791729589074.json

最后一个命令使用 git rev-parse 记录当前 commit，并在 evidence/current 创建新的带时间戳报告；不覆盖旧记录、不连接模型、不需要 Docker 或云账号。
本次记录中的测试命令是 npm test（完整 138 项）而非上面两文件选择；上述选择是成员后续复现建议，不冒充新的执行记录。

复核结果
数据源：docs/evidence/cloud-2026-10-11-retest/prompt-comparison-real-1791729589074.json
原始报告 SHA-256：5bcf29f90edac6c54c32e7e93d0cb3660a34579e2b1d24a064b8edc9d96840c6
prompt v1：原始 v2.0 规则分数 40；v2.1 复核 40；gate=blocked。
prompt v2：原始 v2.0 规则分数 70；v2.1 复核 80；gate=blocked。
原始回答来自 10 月 11 日既有真实实验。本次新增 provider calls=0；不是又跑了 20 次模型。
规则 v2.1 是看过这批答案后修正的，复核只能帮助解释误判，不是独立盲测，也不能据此说质量门禁已通过。
两版仍未满足至少 95 分、零关键失败、零执行错误的完整要求；没有降低阈值或改写旧失败记录。

从本次差异可确认的情况
v1 的 missing 用例由 failed 变为 passed；eligibility 因 no_unperformed_refund_claim 由 passed 变为 failed，总分仍为 40。
v2 的 damaged 用例因人工转交措辞识别修正由 failed 变为 passed，总分为 80。
其他失败解释见 docs/12-Real-Retest-20261011.md；自动规则是有限启发式，不可当成通用语义裁判。

接下来由团队确认和执行，尚未记为完成
1. C 与 B 确认隐私提醒和裸 JSON 消费契约，再设计下一版 prompt；保留旧版本和历史记录。
2. C 与 E 在下一轮调用前冻结新的独立样本、评分规则、运行次数与失败保留方式。
3. 指定真实独立人员逐条看回答并填写 human-rubric；AI 分析不替代这一步。
4. 真实调用或云操作前由账号所有者与 D 核对免费额度、授权和窗口；不自动升级付费。
5. 提交 PR 后请 B/E 本人审核；本目录的出现不表示他们已经审核或同意。

提交与验证边界
新增内容只有本说明与真实已生成的离线验证文件，没有新源码功能、部署、模型调用、人工评分、成员 approval 或合并。
原始完整分工包仍对应 e94d4f1；新 C 分支只是在该基线上追加本目录和证据。其他成员继续从共同基线建立各自分支。
