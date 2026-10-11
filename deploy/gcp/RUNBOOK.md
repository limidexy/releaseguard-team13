# Team 13 试用环境启停

本环境使用 Google Cloud 免费试用。只由拥有该项目权限的维护人操作，不升级账号、不创建额外节点池。操作前核对 `trial-config.json` 中的项目与区域；不要复制或发送私有密钥、令牌或 kubeconfig。

## 恢复演示

恢复会继续消耗试用额度。先核对控制台仍处于免费试用、剩余额度和 S$40 预算，再由维护人主动执行：

```sh
gcloud container clusters resize rg-trial --node-pool=default-pool --num-nodes=2 --zone=asia-southeast1-a --project=project-dcf9bb6a-7310-4602-aea
gcloud container clusters get-credentials rg-trial --zone=asia-southeast1-a --project=project-dcf9bb6a-7310-4602-aea --dns-endpoint
kubectl -n releaseguard get pods,pvc
kubectl -n releaseguard wait --for=condition=Available deployment --all --timeout=600s
node scripts/gcp-run.mjs acceptance
```

首次重启可能需要数分钟重新调度服务。三个 PVC 应仍为 Bound。`gcp-run.mjs` 需要维护人本机已有的 `evidence/private/gcp/secrets.json`，该文件不分发给所有组员。组员通过各自授权身份访问网站，不共享维护人凭据。

云端网址为 https://rg-team13.34.21.137.20.sslip.io 。浏览器真实用户首次登录须本人更改临时密码；不要把 service-client 凭据作为人类审核身份。第二位真实审核人尚需团队确定。

## 演示后停止计算

```sh
gcloud container clusters resize rg-trial --node-pool=default-pool --num-nodes=0 --zone=asia-southeast1-a --project=project-dcf9bb6a-7310-4602-aea
gcloud compute instances list --filter='name~^gke-rg-trial-' --project=project-dcf9bb6a-7310-4602-aea
node scripts/gcp-evidence.mjs --power-only
```

确认计算实例列表为空。不要删除 namespace、PVC、持久盘或数据库。缩到零后网站离线，恢复步骤完成后才可演示。负载均衡、IP、镜像存储、持久盘等保留资源仍可能消耗试用赠金；若不再需要环境，应另行确认数据导出和资源删除范围。S$40 预算提醒不会自动停机。

## 手动部署

1. 团队在 GitHub 查看源代码与真实 CI 结果。当前基础分支仍为 `feat/local-course-evidence`，未经团队 review 不声称已合并。
2. 选择该分支最近成功的 `ReleaseGuard verification` run。工作流源码 commit 必须与待部署分支 commit 完全相同。
3. 在 `Trial cloud deployment (manual)` 输入该 run ID。需要演练镜像回退时启用 `prove_rollback`，且旧镜像必须健康并不同于候选镜像。
4. 检查 `check` 和 `deploy` 都成功，以及 `deployment-evidence` 中的候选、旧版、再次候选 smoke 结果。发生错误时检查恢复证据，不把绿色子步骤当成整体成功。

仓库已按所有者要求公开，但当前工作流仍未配置独立人工批准门禁。手动触发不等于同学批准。工作流使用绑定本仓库和分支的短期身份联合凭据；不要额外创建长期云服务账号 key。冷启动后须先等待全部服务健康，不应绕过部署前置检查。

## 扩容和恢复测试边界

`worker-autoscale.yaml` 使用 KEDA 2.21，最多三个 Worker、单副本请求 150m CPU，限制 500m/384Mi，不增加节点。前三次短时积压扩容未完全通过；第四次在 HPA 已就绪、单个 Worker 进程短暂停止的故障场景中，观察到自动 1→3→1 和五百任务完成。新增 Worker 未赶上处理该次任务，因此不能宣称吞吐收益。不要以手动 scale 到三副本假冒自动扩容。CD 期间 scaler 暂停在一副本；下一次有计划的扩容实验才解除该暂停。

基础设施重建后需运行 `scripts/gcp-reconcile-broker.mjs` 核对实际队列权限。这会按脚本设定校正测试用 broker 用户的 configure/write/read 权限；不读取或输出密码。RabbitMQ 默认配置映射在本次版本与预期不一致，不能只看配置文件就认定权限已生效。

`node scripts/gcp-run.mjs backup` 仅在无压测、无部署写入时执行。同实例临时库校验完成后只删除该次新建的临时库；原库和私有 dump 保留。该演练不证明整个区域、身份库或集群重建后的灾备能力。
