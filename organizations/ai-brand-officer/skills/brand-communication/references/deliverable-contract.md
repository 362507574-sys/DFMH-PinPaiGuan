# 品牌传播候选成果契约

## 晋级条件

只有同时满足以下条件才能打包：

- 计划、证据、候选、审核和调试状态绑定同一 `taskIdentity`、`skillId` 与哈希；
- 上游品牌定位和品牌视觉使用精确 `artifactId@version`、`sha256`，已确认资料不重复索要；
- 规则审核和传播专业审核均通过，两个不同 `reviewerId` 不得相同；
- 调试状态为 `candidate_ready`；
- 传播专用候选已通过 `validateBrandCommunicationCandidate`，并在 Task4 前完成 exact-10、真实证据与职责边界校验；
- `policyContextHash` 已由固定版本、传播校验器源码和候选 Schema 联合计算，并与任务政策文件、候选侧车、审核记录和交付包一致；
- 候选通过 `validateBrandDeliverablePackage`，未知字段（包括额外 `packageHash`）一律拒绝。

成果只返回总控，不直接发布，不写项目 `shared-artifacts/` 或组织 `outputs/`。

## 品牌传播业务内容

本节承载品牌信息体系的机器可读版本。

`communicationContent` 固定且只包含十个字段：

1. `messageHierarchy`：唯一核心信息、支持信息和信任理由；每项均有 `claimKey`、`claimDigest`、`evidenceIds`、`status`；
2. `contentPillars`：可长期积累的品牌内容母题，每个母题绑定主张键、主张摘要和证据；
3. `proofLibrary`：承诺、案例、数据与来源的证据映射，每条证明有独立 `claimKey` 和可核验 `claimDigest`；
4. `brandStory`：真实起源、冲突、选择、价值，以及逐项证据主张；
5. `founderIpPosition`：身份、观点边界、品牌绑定及逐项可核实主张；
6. `campaignMotherIdea`：发布、周年、联名或事件的品牌母创意及事实主张；未调用则标记不适用；
7. `toneAndVoice`：语气、词汇、句式和使用条件；
8. `forbiddenClaims`：禁语、无证据承诺和不可公开信息；
9. `visualBindings`：固定视觉成果引用、必须保持项和冲突检查；
10. `channelAdaptationBoundary`：品牌、增长、成交的职责边界。

十个业务字段不得缺失或增加。系统打包时会在 `contentJson` 中额外写入保留字段 `_brandDeliveryContextCommitment` 用于防篡改；它不是第十一个业务字段，业务侧不得自行填写或修改。

`systemPackage.policyContextHash`：传播与视觉任务为受信政策哈希，非政策型任务统一为 `null`。传播任务恢复时该值不能被替换；政策文件缺失或漂移必须返回 `policy_migration_required`，不能沿用旧审核形成新交付包。

`channelAdaptationBoundary` 必须明确：

> AI品牌官提供品牌信息母体、内容母题、原则、证据和禁区，并负责重大品牌传播；AI增长战略官负责小红书、短视频、公众号、私域等渠道的选题、节奏、运营与获客；AI成交官负责销售沟通、成交话术、成交脚本和成交策略。

不得在业务内容中变相塞入30天小红书种草、短视频日更、公众号日常、私域运营、投流获客、渠道预算、成交话术或成交脚本。

## 业务模板到正式包映射

| 业务模板 | 正式包字段 |
| --- | --- |
| 任务、模块、上游和证据 | `systemPackage.taskIdentity`、`skillId`、`selectedModuleIds`、`upstreamArtifacts`、`evidenceRefs` |
| `communicationContent` | 候选 `output.contentJson` 中的业务正文 |
| 事实、判断、假设、未知 | `systemPackage.businessContent` |
| 两层审核 | `systemPackage.review` 与审核凭证绑定 |
| 必须保留、可适配、禁止修改 | `systemPackage.downstreamInstructions` |
| 淘汰与返工 | `eliminationAndReworkHistory`、`debugTrace` |
| 帝王版 | `humanSummary` 的结论、依据、限制、下一步 |
| 下游建议 | `nextOrganizationRecommendation` |
| 整包哈希 | 顶层 `sha256` |

模板中的 `ruleReview` 与 `professionalReview` 保存完整双审核凭证；正式包按运行时受信审核映射为 `systemPackage.review`，不能用模板自报内容替代受信校验。

## 硬性拒绝

- 虚构品牌起源、创始人经历、客户案例、数据或荣誉；
- 无证据使用“第一、唯一、领先、保证增长、保证成交”；
- 无证据创始经历仍被写成确定事实，未标记“待验证”；
- 任一可确认主张缺少安全 `claimKey` / `claimDigest`、引用本次证据包中不存在的证据、借用不同 `claimKey` 的无关荣誉、使用无 `claimKey` 证据确认，或让同一证据跨不同主张复用；
- 确认级 `claimDigest` 为空，候选实际主张文本重算值、候选填写摘要与任一引用证据 `evidence.claim` 重算值不一致，候选以不同文案借用正确证据摘要，多证据混入不同事实，或同一 `claimKey` 被用于不同事实；
- 多个相互竞争的核心信息；
- 品牌官接管日常渠道运营、投流获客、私域培育或成交执行；
- 定位精确版本缺失、冲突或哈希不符；内容传播/品牌活动缺少视觉精确版本；纯故事/创始人任务伪造视觉引用；
- 使用白名单之外的近似上游 ID（包括 `brand-positioning-fake`、`brand-visual-fake` 及任意伪造后缀）；长期应由总控补充受信 `producerSkillId`、`artifactType` 与元数据哈希，本地不得自报；
- 传播政策文件缺失、篡改、哈希漂移或源码/Schema 版本变化后仍尝试复用旧候选、旧审核；
- 两层审核同人、任一审核失败，或尝试第四轮同根因修正；
- 自动对外发布、联系客户或把候选冒充正式资产。

证据不足时必须标记未知或待验证，列出取证路径、负责人和停止条件。
