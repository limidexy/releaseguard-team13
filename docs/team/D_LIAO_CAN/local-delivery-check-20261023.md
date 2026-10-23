# D LIAO CAN 本地交付检查（2026-10-23）

## 工作记录

- 成员：D LIAO CAN
- 日期：2026-10-23（新加坡时间）
- 基线：`e94d4f1c1b438a90551c18f832c7844e1a822df2`（`feat/local-course-evidence`）
- 分支：`ci/d-delivery-runbook`
- 环境：Windows；Node.js `v26.7.0`；npm `11.19.0`
- 数据来源：本地构建与受控测试输入（synthetic/replay）；没有真实模型调用

## 实际执行

| 命令 | 结果 |
| --- | --- |
| `npm ci --no-audit --no-fund` | 通过，安装 69 个依赖包 |
| `npm test` | 通过，TypeScript 测试 138/138 |
| `node --test tests/image-identity.test.mjs` | 通过，1/1 |
| `node --check public/app.js` | 通过 |
| `wsl.exe -d Ubuntu-22.04 -- docker version` | 通过；Docker Server `29.1.3`，Ubuntu-22.04 正在运行 |
| `wsl.exe -d Ubuntu-22.04 -- docker compose config --quiet` | 通过 |
| `wsl.exe -d Ubuntu-22.04 -- docker compose build gateway postgres` | 通过；镜像内 `npm test` 138/138 |
| `wsl.exe -d Ubuntu-22.04 -- docker compose down -v --remove-orphans` | 通过；清理本地 Compose 项目残留卷以重新初始化账号 |
| `wsl.exe -d Ubuntu-22.04 -- docker compose up -d --build --wait` | 通过；postgres、rabbitmq 及 6 个应用服务均达到 `healthy` |
| `wsl.exe -d Ubuntu-22.04 -- docker compose ps` | 通过；所有服务运行中且健康 |
| `wsl.exe -d Ubuntu-22.04 -- docker compose down` | 待本记录结束时执行 |

`scripts/verify.mjs --restart` 未直接执行：Windows Node 找不到 Docker CLI，而 Docker CLI 仅在 WSL 中可用；已完成 Compose 等价的容器健康验证。没有启动云资源、修改云配置、调用模型或产生云费用。

## 已知限制与下一步

如需运行完整 `scripts/verify.mjs --restart`，应在 Docker CLI 与 Node 位于同一环境的 shell 中执行；云端启停、回滚、备份恢复和授权变更仍需由有权限的维护人协调，不能用本记录替代真实云证据。

## AI 使用与审核

Codex 协助读取交接资料、定位 D 角色文件并运行上述命令；本记录只包含本次实际执行结果。独立组员审核：待安排。

