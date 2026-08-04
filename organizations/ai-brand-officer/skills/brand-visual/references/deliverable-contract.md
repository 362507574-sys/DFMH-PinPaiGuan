# 品牌视觉候选成果契约

## 身份与版本

每个候选固定到一个 `taskIdentity`，并记录：

- `enterpriseId`、`businessProjectId`、`taskId`
- `skillId = brand-visual`
- `selectedModuleIds` 与 `unselectedModuleIds`
- `upstreamArtifacts`：每项精确 `artifactId`、`version`、`sha256`
- `aestheticProfileRef`：当前项目档案及其版本/哈希；首次项目真实无档案时只允许 JSON `null`，禁止 `{}` 或伪空对象。`null` 不豁免恰好三个方向及其唯一资产、三对差异证据门禁
- 候选版本、候选哈希、状态和生产等级

禁止引用 `current`、“最新版”或缺少哈希的上游资产。跨项目审美档案只有其完整 `artifactId@version + sha256 + sourceOrganizationId` 固定导入引用精确存在于可信计划 `upstreamArtifacts` 时可以进入；候选正文声称“已授权”无效。

## 视觉正文

按实际模块包含：

1. 定位依据、现状诊断、视觉策略、参考视觉 DNA 与禁用方向；
2. 恰好三个方向；每个方向绑定唯一 `assetRef` 或 `imageSha256`，并以 `pairwiseDifferenceEvidence` 覆盖三对方向且每对至少两个枚举视觉维度；
3. Logo/字标、色彩、字体、图形、图像、版式和使用规则；
4. 门店门头、导视、展示、材质和灯光概念及非施工边界；
5. 包装结构适配、标签层级、法规字段来源、材质工艺和印刷边界；
6. 人物、产品、素材、字体、IP 与生图通道授权；
7. 产品原貌、精确文字、单图/系列和品牌一致性总审；
8. 概念、可编辑性、施工、法规、印刷、发布和正式化限制；
9. 淘汰候选、返工历史和审美档案变更依据。

未选择模块必须标记“本次未调用”，不得生成伪完成内容。

术语必须明确：字体授权、图片授权和 AI生成性质分别记录；AI 图不能冒充正式Logo；门店概念效果图不能冒充施工文件；包装法规字段必须有依据；系列一致性不能被单图效果替代。

## 公共能力交接

`publicCapabilityHandoff` 记录公共能力调用与回收：

- `registryRef.path` 必须是根级唯一事实源 `public-skills/registry.json`；同时记录 `registryRef.versionOrHash`、`registryRef.sha256` 与 `registryRef.readAt`。登记表存在版本字段时写版本并保留文件哈希；不存在时以 `sha256:<digest>` 作为 `versionOrHash`。
- 每个交接记录 `publicSkillId`、`capabilityId`、本次读取的 `maturity`、`allowedOrganizations`、`controllerTaskAuthorizationRef`、`authorized` 与 `decision`。控制引用固定企业、项目、任务、`contextVersion`、`project.json` 原字节 SHA-256 和 `commanderTaskId`。
- 运行时只信现场读取的根登记表和当前 `project.json`：只有 `maturity === operational`、许可组织包含 `ai-brand-officer`、`project.json.publicSkillIds` 包含目标公共 Skill，且总控任务引用与可信策略上下文一致时才允许正式调用；三项缺一直接拒绝。
- 普通海报绑定 `public.promotional-poster` / `promotional-poster`，动态允许后目标为 `skills/creating-promotional-posters/SKILL.md`；输入品牌策略简报、视觉 DNA、核心信息、品牌资产、禁用方向与渠道，返回候选后必须再次执行品牌官总审和最终否决。
- 淘宝套图绑定 `public.taobao-ecommerce-image-set` / `taobao-ecommerce`，动态允许后目标为 `workflows/TAOBAO_ECOMMERCE_IMAGE_SET_PILOT.md`。
- 公共能力不计入品牌官三个核心 Skill，不复制到组织目录。

## 双审核

- `ruleReview`：身份、版本、证据、授权、产品原貌、精确文字、边界、硬否决与禁止写入检查；
- `professionalReview`：定位承接、区别度、识别延展、审美、系列、DNA 对照和生产可用性；
- 两个不同的 `reviewerId` 必须来自不同角色，绑定同一 `candidateHash`、`planHash` 和 `evidenceHash`；
- 专业审核只读 `task`、`evidence`、`candidate`、`rubric`，不读取执行者自评与辩护；
- 任一审核失败、海报命中硬否决或低于 80 分时不得进入可提交候选。

## 双层交付

`humanSummary` 面向帝王，必须包含结论、依据、实际模块、推荐候选与淘汰原因、限制/风险/未知和必要下一步。

`systemPackage` 面向总控和授权下游，至少包含 `taskIdentity`、`selectedModuleIds`、`upstreamArtifacts`、`evidenceRefs`、视觉正文、公共能力交接、审美档案引用、必须保持/可适配/禁止修改项、`ruleReview`、`professionalReview`、调试轨迹、版本、哈希和状态。

两层指向同一候选、证据和版本；人类版不得隐藏会改变帝王判断的限制。

## 业务模板到正式包映射

双审核通过后由正式 packager 自动映射并调用运行时验证：

| 业务模板内容 | 正式包字段 |
| --- | --- |
| 视觉 DNA、三方向、模块成果、公共能力交接、生产边界、审美引用、双审核 | `systemPackage.output.contentJson`；规范正文哈希进入 `contentSha256` |
| 事实、专业判断、假设、未知、结论、推荐和风险 | `systemPackage.businessContent` |
| 保持项、可适配项、禁止修改项 | `systemPackage.downstreamInstructions` |
| 规则与专业审核合并裁决 | `systemPackage.review`，详细双审核仍保留在正文 |
| 淘汰与返工 | `systemPackage.eliminationAndReworkHistory` |
| 调试状态与三轮轨迹 | `systemPackage.debugTrace` |
| 下一组织或公共能力建议 | `systemPackage.nextOrganizationRecommendation` |
| 最终包哈希 | 只允许正式包顶层 `sha256`；`systemPackage.packageHash` 或其他未知 `packageHash` 一律拒绝 |

`planHash`、`evidenceHash`、`candidateHash`、`reviewHash`、`debugStateHash`、`baseCandidateHash`、`executionContextCommitment` 和 `deliveryContextCommitment` 由运行时绑定，不允许人工覆盖。

正式 packager 构造完成后必须调用 `validateBrandDeliverablePackage` 复验，不能以模板字段代替真实正式包校验。

## 硬性拒绝

- 抽象“高级、科技、国际化”没有转译为可验证视觉变量；
- 黑金、金边、暗棚拍、模板底栏或廉价 AI 感替代品牌区别度；
- 字体、图片、人物、产品、IP 或通道授权未说明；
- AI 生成图冒充正式 Logo，公开预查冒充商标结论；
- 门店概念冒充施工、结构、消防、电气或建成现场；
- 包装无依据补造结构、标签、法规字段或印刷结论；
- 产品原貌或精确文字错误；
- 单图通过替代系列、DNA 和品牌总审；
- 未授权写入 `shared-artifacts/`、`outputs/`、正式发布或版本切换。

## 返回边界

成果只写当前任务的品牌官工作区并返回总控。AI品牌官不得直接写项目 `shared-artifacts/`，不得写根级 `outputs/`，不得自行发布、晋级、切换正式版本或绑定下游。
