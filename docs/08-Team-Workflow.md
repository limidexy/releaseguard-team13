# 五人分工与真实 Git 交付流程

更新：2026-10-11。保留已确认分工。Sprint 1：10 月 8–13 日；Sprint 2：10 月 14–20 日，为计划日期，实际完成时间据实记录。

私有仓库：https://github.com/limidexy/releaseguard-team13

## 每个人负责什么

| 成员 | Sprint 1 | Sprint 2 | 主要代码 / 文档路径 |
|---|---|---|---|
| A — TANG YUCHEN | 确认需求，完善提交、结果、审核页面 | 用户验收、页面修正、组织演示 | `public/`；UAT 实录；`docs/team-effort.csv` |
| B — ZHU PENGXU | 核验 API、数据库和审批逻辑；和 C 联调；讨论 DDD 边界 | 修复权限、重试、历史证据问题 | `src/registry.ts`、`evaluation.ts`、`governance.ts`、`contexts/`、`domain.ts`、`common.ts`；`docs/07-DDD-Design.md` |
| C — LIN XINDA | 接入一个现成模型，至少 10 个固定用例，保留真实回答 | 比较两个 prompt，分析失败与人工审核 | `src/support.ts`、`provider.ts`、`public/demo-fixtures.json`、`scripts/compare-prompts.mjs`、`docs/human-rubric.csv` |
| D — LIAO CAN | 团队云端访问；测试、构建、部署链路 | 版本恢复、部署证据、运行说明 | `Dockerfile`、`compose.yaml`、`deploy/`、`.github/`、`.githooks/`、`scripts/prepush.mjs` |
| E — LIAO BINFENG | 安全/性能方案与基础检查 | 负载、安全、故障测试及复测 | `tests/`、`scripts/verify*.mjs`、`mixed-load.mjs`、`benchmark*.mjs`、`fault-test.mjs`、`acceptance.mjs` |

这是责任分区，不是五份互不相关的应用。共享接口的改动先与依赖方沟通。基础代码和 AI 辅助修改不等于某位成员的个人贡献；不得把生成的提交改名伪装成组员工作。

## 当前身份和权限

仓库所有者为 `limidexy`；另外四位 GitHub 用户名待提供。尚未邀请未知账号，也未虚构 CODEOWNERS 或人工 approval。成员加入后，用自己的账号和正确姓名/邮箱提交，由不同组员审核。

## 每个人的操作顺序

1. 接受仓库邀请并克隆；安装 Node.js 24+ 与 Docker。阅读 README，单独生成 `.env`，不要共享任何人的密钥文件。
2. 从团队实际工作分支/已合并主分支创建任务分支。例如 `feat/a-uat-errors`、`feat/b-review-policy`、`feat/c-provider-evidence`、`ci/d-cloud-smoke`、`test/e-mixed-load`。
3. 先写/调整测试，再实现自己的任务，保留失败原因和复测结果。不要为了凑 Git 记录而制造无意义提交。
4. 在此克隆目录启用本地检查：`git config core.hooksPath .githooks`。macOS/Linux 首次运行 `chmod +x .githooks/pre-push`。这是本地辅助门禁，可被绕过，不能替代受保护分支/远端 CI。
5. `git add <明确的文件>` → `git diff --cached` 核查 → `git commit -m "描述真实改动"` → `git push -u origin <你的分支>`。push 前会跑类型/单元测试和基础敏感文件扫描。`.env` 与测试私有输入不提交。
6. 在 GitHub 创建 PR，写明问题、改动、执行过的测试、限制、AI 使用。贴对应证据及运行链接。请另一位成员实际查看、留言和 approval 后再合并；不要自己冒充另一位审核人。

当前 `feat/local-course-evidence` 是 AI 辅助基础补全分支，应先由团队 review，再决定是否合并。正式组员任务应从这个分支被接受后的 main 开始，或明确以该分支为基线。

## 给老师展示什么

- GitHub commit 页面：真实时间、作者、diff。基础导入和 AI 辅助提交诚实标注。
- 一个真实成员 PR：需求 → 代码/test diff → 本地测试 → `git push` → 另一位成员评论/批准 → 合并。
- `evidence/git/pre-push.json` 仅证明本地 hook 执行，不是 hosted CI。
- `.github/workflows/ci.yml` 开启后，展示实际 Actions 链接、exact source commit、镜像 ID、测试日志、失败阻断和 artifact。**Skipped ≠ Passed。**
- `.github/workflows/cd.yml` 配好云账号和受保护环境后，再展示人工批准、同一镜像部署、smoke 和回滚。现在不把 YAML 文件冒充部署成功。

## 不收费边界 / 待账号事项

Hosted CI 需要仓库变量 `RG_ENABLE_HOSTED_CI=true`。开启前由 owner 核实私有仓库当前套餐剩余免费分钟、存储和零支出预算；本次默认不开启，避免未经授权费用。工作流还会上传镜像，有存储占用。cloud CD 另需 `RG_ENABLE_CLOUD_CD=true`，云账号、预算、OIDC/HTTPS、DB/broker、镜像仓库、KUBE_CONFIG 和 smoke 身份。

模型需要平台名、已登录情况、允许的模型和明确额度。密钥只放本地 `.env` 或服务端 secret，不发聊天。没有账号时只运行明确标注的 replay，并把真实 prompt 比较/人工 rubric 保留为未完成。

GitHub 官方参考：[工作流触发](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)、[Actions 用量与计费](https://docs.github.com/en/billing/concepts/product-billing/github-actions)。免费额度需按账户现状核实。
