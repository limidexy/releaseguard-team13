# ReleaseGuard v17 checker r1 离线复核

- 状态：**READY_FOR_REAL_EVALUATION**
- 修复前状态：**OFFLINE_NOT_READY — CHECKER_CORRECTNESS_FAILED**
- 测试：**697/697 通过，0 失败**
- 真实模型调用、部署、发布、推送：**0 / 0 / 0 / 0**

## 定点修复

1. 接受 “Your return is eligible under the standard policy” 和 “return is standard eligible”。
2. 接受 “Please let us know if you have a receipt”，同时继续阻断图片、编号、内容和上传要求。
3. 否定人工审核、否定日期未知、后续矛盾句不再被正向关键词抵消。
4. 条件句或引用句不作为已完成义务；无法确认的关键表达标为 unverifiable 并阻断。
5. 实际执行 clarificationBlocksHumanContact=false，阻断“先提供日期才能联系人工”。

修复前新增校准测试为 0/10，通过日志保留为 red-before-fix.log；修复后这些测试及原有危险负例全部纳入全量测试。

## 历史口径复核

| Evaluation | Score | Raw gate | Independent old guard allowed/blocked | Score + old guard combined allowed/blocked |
|---|---:|---|---|---|
| v15 original v2.9 | 90 | blocked | 19/1 | 17/3 |
| v15 same raw, v2.10 rescore | 100 | passed | 19/1 | 19/1 |
| v16 original v2.10 | 90 | blocked | 17/3 | 17/3 |

旧原文的新检查结果不是目标通过率。逐题分类保存在 historical-diagnostics-r1.json；类别分为 true_obligation_omission、checker_false_block、business_contradiction 和 unverifiable。修复后的 explicit calibration 中没有遗留 checker_false_block，但历史原文仍可能因真实遗漏或矛盾被阻断。

## 离线结论

20/20 契约无冲突编译；plain/JSON 只改变格式；原文未被改写；mock provider 继续证明一题一次请求、错误不重试、无 fixture 替答。离线校准完成，可以冻结后进行唯一一轮真实 v17 20题评估。本状态不表示模型达到95/100，也不表示可部署或发布。
