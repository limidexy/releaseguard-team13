# 当前交付与验收边界

## 2026 年 10 月 11 日云端更新

下列 10 月 7 日内容为历史基线。最新云端运行、模型、预算和 CI/CD 证据见 [云端验收记录](10-Cloud-Acceptance-20261011.md)。云端已实际部署，不再处于“没有云账号”的阶段；团队独立 UAT、人工评分、成员 PR 和完整课程报告仍需完成。网页旧提示尚未修改，须经用户确认。

## 10 月 7 日历史基线

2026 年 10 月 7 日。本版是经过本机验证的微服务课程基线，不是满分保证或云端完成声明。

## 已完成的改进

- 修复空白回答在 not_contains 安全规则中被误判为通过的缺陷。先运行回归测试观察失败，再修改实现并通过测试。
- 模型适配器限制响应字节数，拒绝空回答及非 HTTPS 或带用户信息的地址。保留 prompt 原文和哈希、已知请求编号、模型名称和可用 token 用量。测试使用受控传输替身，不代表真实供应商兼容性已经验证。
- 回放案例只查自有键，未知案例不会意外读取对象原型。
- 中英文控制台展示逐项证据、执行状态与门禁的区别、两个候选比较、分页历史、独立审核及导出。原始用例与回答不翻译。
- 浏览器和脚本使用同一用例目录，避免两份测试数据各自漂移。浏览器增加内容安全策略。
- 数据库启动脚本复制进 Linux 镜像，避免本次 Mac 挂载执行权限失败；干净的新测试卷启动通过。
- 自动验收命令记录各步骤退出码、日志与开始时源码哈希。三轮副本对比变换顺序，保留错误和任务时间数据，结束后恢复副本数。

## 本轮亲自运行的结果

- `evidence/current/acceptance.json`：九个本地步骤全部退出 0，执行过程中源码未变。
- `unit-tests.log`：16 项单元/适配器测试通过。
- `evidence/integration-local.json`：原有 18 组跨服务及安全检查通过。
- `improvements-integration.json`：4 组新增检查通过，包括空白回答不能进入审核、原型键回放、页面资源/CSP、分页边界。
- `evidence/fault-local.json`：Worker 强制退出后重试成功。只支持进程恢复，不支持数据库恢复或跨节点高可用结论。
- `prompt-comparison-replay-*.json`：同一个 suite 下 v1/v2 回放运行与逐项报告生成成功。相同静态回答不能证明 prompt 改善；人工评分仍为空。
- `scaling-repeated-first-run.json`：首轮每轮每配置 120 个十用例任务，8 个提交客户端，3 轮 1/3 副本配对。720 个测量任务，另有 60 个预热任务。中位数吞吐约 126.29 对 137.03 jobs/s，总完成 p95 的轮次中位数 344 对 331 ms，错误 0。约 8.5% 的本地短负载提升不代表线性扩展或持续云容量。与原 Windows 短测不同机器、不同观察流程，不作为跨版本性能改进百分比。
- `scaling-repeated.json`：最终相同协议复测，1/3 Worker 吞吐中位数为 146.06 / 133.26 jobs/s，完成 p95 的轮次中位数为 348 / 391 ms，测量任务仍为 720 个、错误 0。三个 Worker 反而低约 8.8%，没有重现首轮提升；因此尚未建立稳定扩容收益，不能选择性呈现首轮结果。
- 漏洞公告检查的完整结果在 `dependency-audit.log`。零已知公告不是无漏洞证明，也不是容器扫描完成。

## 怎么启动

使用 Node 24、Docker Desktop 和空闲的 5189 端口。在完整源码目录运行：

```sh
npm ci --no-audit --no-fund
npm test
node scripts/setup-local.mjs
docker compose build gateway postgres
docker compose up -d --no-build --wait
npm run tokens
```

打开 http://localhost:5189，粘贴 developer 本地令牌，登记用例，运行 passing / failing / error 回放。审核时换 reviewer 令牌。身份只保留在当前页面内存。不同成员使用自己的完整副本启动，实际协作仍使用一个仓库、个人分支和评审。

当前本机测试栈名称为 `rg-improved-verified-20261007`；在这台机器维护该栈时先设置 `COMPOSE_PROJECT_NAME`，否则默认名称会指向另一套容器。不要同时在 5189 启动多套。停止命令为 `docker compose stop`，不删除数据；保留本机 `.env` 与对应卷。交付 ZIP 不含 `.env`，新机器自行生成。

## 尚未完成

1. 实际模型供应商账号、授权和预算；至少两次真实 prompt 运行及独立人工评分。
2. 云平台、OIDC 身份及预算确认；云端 HTTPS、私有服务、数据库/队列、真实账号 UAT。
3. 实际 GitHub 仓库、托管 CI/CD run、镜像扫描、部署批准与回滚证据。
4. 云端持续读写负载、自动扩缩容轨迹、数据库增长和瓶颈观测；不能以本地副本对比代替。
5. 数据库备份恢复演练、多节点故障、正式项目报告、成员实际投入和贡献记录。
6. 新版正式演示视频及幻灯片尚未重做。旧网站视频不能作为本微服务版演示。

这些缺口依赖真实账号或团队参与。没有对应证据的项目必须保持未验证，不能因本地测试全绿而宣称课程全部完成。

## 五人接续

| 成员 | 主要文件 | 下一项可验收成果 |
| --- | --- | --- |
| A TANG YUCHEN | public/index.html、app.js、style.css | 独立多身份 UAT；审核理由与演示流程 |
| B ZHU PENGXU | src/registry.ts、evaluation.ts、governance.ts、domain.ts | 讲清数据库与 API 边界、幂等和审核一致性 |
| C LIN XINDA | src/provider.ts、support.ts、scripts/compare-prompts.mjs、public/demo-fixtures.json | 获授权的真实 v1/v2 回答、失败分析与独立评分 |
| D LIAO CAN | compose.yaml、deploy/、.github/workflows/ | 选择一条可操作云路线，提交实际部署与 CI/CD 证据 |
| E LIAO BINFENG | tests/、scripts/verify-improvements.mjs、benchmark-repeated.mjs、acceptance.mjs | 云端持续实验、安全复测、故障与瓶颈分析 |

共享 common.ts、domain.ts、fixtures 和接口字段需协作评审，不按成员复制成五套产品。AI 辅助生成及已有基线不代表学生实际贡献；每人应理解负责部分并记录真实工作。
