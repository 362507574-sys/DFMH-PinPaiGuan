# 品牌定位候选成果契约

## 身份与版本绑定

每个候选包固定到一个 `taskIdentity`，并记录：

- `enterpriseId`
- `businessProjectId`
- `taskId`
- `skillId = brand-positioning`
- `selectedModuleIds` 与 `unselectedModuleIds`
- `upstreamArtifacts`：每项必须有精确 `artifactId`、`version`、`sha256`
- 候选版本、候选哈希和状态

禁止引用 `current`、“最新版”或没有哈希的上游成果。

## 定位正文

1. 品牌现状诊断；
2. 品类定位与客户理解成本；
3. 首要用户、使用者、决策者、付费者和非首要用户；
4. 使用场景、触发时刻、购买动机、阻力和实际替代；
5. 竞争心智与空缺位置；
6. 差异化价值、支持证据、反证和未知项；
7. 品牌定位陈述、核心价值主张和信任理由；
8. 一个 `primaryMindshare`、辅助认知和 `nonTargetMindshare`；
9. 品牌架构；
10. 名称与口号候选及风险（适用时）；
11. 定位验证；
12. 供品牌视觉与品牌传播只读使用的战略简报。

未选择的模块必须标记“本次未调用”，不得生成伪完成内容。

## 证据与审核

`evidenceMap` 把每个关键主张映射到证据，并区分事实、推断、假设、未知。来源冲突、禁用信息和验证缺口必须保留。

审核记录包含：

- `ruleReview`：规则门禁、失败项、`reviewerId`、`reviewerRole=rule-engine`、`reviewedAt`、`candidateHash`、`planHash`、`evidenceHash`；
- `professionalReview`：定位专业结论、六维判断、失败项、`reviewerId`、`reviewerRole=brand-professional-reviewer`、`reviewedAt`、`candidateHash`、`planHash`、`evidenceHash`；
- 两个不同的 `reviewerId` 必须来自不同审核角色，角色不得互换，并绑定同一 `candidateHash`、`planHash` 与 `evidenceHash`；
- 专业审核只读 `task`、`evidence`、`candidate`、`rubric`，不继承执行者说明、自评或辩护；
- 任一审核失败时不得标为 `candidate_ready` 或 `preferred`。

## 双层交付

`humanSummary` 面向帝王，按结论、依据、实际执行模块、候选与淘汰原因、限制与风险、必要下一步表达。

`systemPackage` 面向总控和获授权下游，至少包含 `taskIdentity`、`selectedModuleIds`、`upstreamArtifacts`、`evidenceMap`、定位正文、保持/可适配/禁止修改项、`ruleReview`、`professionalReview`、调试轨迹、版本、哈希和状态。

双层内容必须指向同一个候选和证据版本，不得在人类版隐藏会改变业务判断的限制。

## 业务模板到正式包映射

业务模板不直接冒充运行时产物。双审核通过后，由正式 packager 自动完成以下映射并调用 `validateBrandDeliverablePackage` 复验：

| 业务模板内容 | 正式 `brand-deliverable-package` 字段 |
| --- | --- |
| 品类、用户、差异化、主心智、品牌架构、命名风险、`evidenceMap`、`ruleReview`、`professionalReview` | `systemPackage.output.contentJson` 的规范 JSON 正文；其哈希进入 `contentSha256` |
| 事实、专业判断、假设、未知 | `systemPackage.businessContent.facts / judgments / assumptions / unknowns` |
| 业务结论、推荐候选、确认结论、风险、决策请求 | `systemPackage.businessContent` 对应字段 |
| 下游保持项、可适配项、禁止修改项 | `systemPackage.downstreamInstructions.mustPreserve / mayAdapt / forbiddenChanges` |
| 规则与专业审核的合并裁决 | `systemPackage.review`，详细双审核仍保留在 `output.contentJson` |
| 淘汰与返工记录 | `systemPackage.eliminationAndReworkHistory` |
| 调试状态与时间线 | `systemPackage.debugTrace` |
| 推荐下游组织 | `systemPackage.nextOrganizationRecommendation` |
| 最终包内容哈希 | 顶层 `sha256`；模板别名为 `packageHash` |

`planHash`、`evidenceHash`、`candidateHash`、`reviewHash`、`debugStateHash`、`baseCandidateHash`、`executionContextCommitment` 与 `deliveryContextCommitment` 均由运行时自动绑定，不允许人工填写或覆盖。

## 硬性拒绝

- “高品质、专业、创新、用户至上”没有证据和具体机制；
- “年轻人、女性、中高端”等宽泛用户没有场景与角色；
- 多个同等重要的心智位置；
- 证据不足却写成确定事实、保证结果或行业第一；
- 名称公开预查被写成商标一定可注册；
- 候选包含未授权外部发布、渠道运营或正式资产晋级。

证据不足时使用“待验证”，并写明需要什么事实、如何验证和停止条件。

## 返回边界

成果只写当前任务的组织临时工作区并返回总控。AI品牌官不得直接写项目 `shared-artifacts/`，当前不得写根级 `outputs/`，不得自行发布、切换正式版本或绑定下游。
