# ReleaseGuard presentation questions and answers

1. **Why combine deterministic controls and semantic review?**

   Deterministic checks establish facts, structure, identity and release conditions. Semantic review interprets the meaning of the unchanged answer. The reviewer remains a shadow experiment until separate calibration establishes its qualification.

   中文提示：程序负责可机械核验部分，模型负责语义，当前不能自动放行。

2. **What happens if the reviewer is wrong?**

   We preserve its original judgment and evidence. We report false allows, false blocks and unverified cases separately. Current reviewer status is calibration_pending, so its output cannot authorise customer delivery.

   中文提示：不修模型原始判定、不现场调规则追认成功。

3. **Is a score of 95 enough?**

   No. The gate also requires zero critical failures and execution errors. Applicable output and evidence checks must pass. A review decision belongs to a later workflow step.

   中文提示：分数和硬条件取交集，审核是下一步。

4. **How do you preserve the original model score?**

   We save the original answer and versioned scorer result. A later offline rescore or review has its own version and source. We do not rewrite the original 70/75 generation scores or repair the model's answer after generation.

   中文提示：新版派生成绩不能覆盖原始成绩。

5. **Why is the old pilot incomplete while the v3 runs passed?**

   The old pilot stopped on a v2 evidence/missingReason conflict after three attempts. Its completion seal remains unchanged. The additive v3 protocol removed that redundant model field. Two later experiments independently met their fixed criteria.

   中文提示：旧实验状态不被新实验改写。

6. **Why keep shadowOnly after passing?**

   These are bounded development observations using frozen project labels. They do not establish general language reliability, independent human calibration or production approval. We keep the formal Worker path unchanged.

   中文提示：限定开发验证通过与生产资格不同。

7. **What does the 17-sample result show?**

   For that frozen set, all 17 protocol results were valid, all nine compliant answers were allowed, and all eight violations and expected critical issues were identified. It is separate from the three-sample protocol experiment and is not a general accuracy estimate.

   中文提示：17条固定开发分母，不拼成一个20/20。

8. **Which records came from real calls?**

   Dated customer-generation and semantic-review experiments contain real supplier responses and metadata. Unit fixtures are synthetic. Replay is static fixture execution through the platform. Imported outputs are caller supplied. Today's historical playback makes no new provider call.

   中文提示：四类来源分别解释。

9. **Why not switch the customer generator to 120B?**

   The frozen customer A/B run scored 70/75, but neither arm satisfied the full delivery conditions. A larger model did not establish a safe production choice. The 120B semantic reviewer is a different role and experiment.

   中文提示：客服生成模型与评审模型角色不同。

10. **Are these autonomous microservices?**

    Three business contexts run as separate services and own separate databases. Workers scale within Evaluation. The shared image, repository and local stateful infrastructure leave release and availability coupling. We state those limitations explicitly.

    中文提示：有独立进程和所有权，但不夸大完全自治或高可用。

11. **Does the demo prove scalability or disaster recovery?**

    Historical replay and controlled pause tests show worker distribution and scaler behaviour in the stated environment. The restore check is a same-instance logical restore. Neither demonstrates sustained model throughput, high availability or multi-region disaster recovery.

    中文提示：测了什么就说什么。

12. **Is the current CI/CD green and deployed?**

    The new feature push does not automatically match the current CI push filter. Clean-checkout regression retains one old evaluator failure. Historical CI/CD succeeded for their own exact commits. We did not deploy this preparation branch, and we do not present a missing or skipped run as a pass.

    中文提示：历史绿不代表当前绿，CI与CD、人工审批分别核验。
