# 品牌视觉候选简报

## taskIdentity

- enterpriseId：
- businessProjectId：
- taskId：
- skillId：`brand-visual`
- candidateVersion：
- candidateHash：
- status：

## selectedModuleIds

- 已选择：
- 本次未调用：
- 选择理由与依赖：

## upstreamArtifacts

| artifactId | version | sha256 | 来源组织 | 用途 |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

禁止填写 `current`、`latest` 或无哈希的模糊版本。

## evidenceMap

| claimId | 事实/判断/推断/假设/未知 | sourceId | 限制与验证 |
| --- | --- | --- | --- |
|  |  |  |  |

## aestheticProfileRef

首次项目确认没有审美档案时，本字段整体填写真实 JSON `null`，不得填写 `{}`、空字符串或伪空对象。`null` 只表示无档案，三个方向、三份唯一资产和三对差异证据仍全部必填。存在档案时填写：

- enterpriseId：
- businessProjectId：
- brandId：
- artifactId：
- version：
- sha256：
- importSnapshotRef：（同项目填 `null`；跨项目填写完整固定导入引用）
  - artifactId：
  - version：
  - sha256：
  - sourceOrganizationId：
- 本次是否因帝王明确通过/否决更新：

## 参考视觉DNA（visualDna）

- 构图：
- 裁切与主体比例：
- 光线：
- 色彩：
- 字体：
- 图形与图像：
- 材质：
- 留白：
- 信息密度：
- 反面模式：

## directionCandidates

### directionId：direction-01

- assetRef 或 imageSha256：（必须二选一）
  - artifactId：
  - version：
  - sha256：
  - sourceOrganizationId：
- imageSha256：

### directionId：direction-02

- assetRef 或 imageSha256：（必须二选一）
  - artifactId：
  - version：
  - sha256：
  - sourceOrganizationId：
- imageSha256：

### directionId：direction-03

- assetRef 或 imageSha256：（必须二选一）
  - artifactId：
  - version：
  - sha256：
  - sourceOrganizationId：
- imageSha256：

## pairwiseDifferenceEvidence

- directionIds：`direction-01` + `direction-02`
  - dimensions：（至少两个枚举视觉维度）
- directionIds：`direction-01` + `direction-03`
  - dimensions：（至少两个枚举视觉维度）
- directionIds：`direction-02` + `direction-03`
  - dimensions：（至少两个枚举视觉维度）

允许的 `dimensions`：`composition`、`crop`、`lighting`、`color`、`typography`、`material`、`whitespace`、`information-density`、`graphic-language`、`image-language`。三个方向的资产哈希必须唯一；只改说明不构成新方向。

## moduleOutputs

### visual-identity-system

- Logo/字标：
- 色彩、字体、图形、图像、版式：
- 使用规则与错误示例：

### store-identity

- 门头、导视、展示、材质、灯光：
- 概念/深化/施工边界：

### poster-art-direction

- 品牌策略简报：
- 根公共海报任务引用：
- 返回候选与最终品牌否决：

### product-packaging

- 结构、标签、法规字段、材质、印刷：
- 已有依据、占位与禁止补造：

### ai-visual-generation

- 人物/产品/素材授权：
- 通道与当前版本授权：
- 产品原貌与支持视角：
- 确定性排版字段：

## publicCapabilityHandoff

> 每个实际交接都必须在调用前读取根登记表；未使用的条目删除，不得复制登记表正文或预填成熟度。

### handoff-01

- registryRef：
  - path：`public-skills/registry.json`
  - versionOrHash：
  - sha256：
  - readAt：
- publicSkillId：`public.promotional-poster`
- capabilityId：`promotional-poster`
- maturity：
- allowedOrganizations：
- controllerTaskAuthorizationRef：
  - enterpriseId：
  - businessProjectId：
  - taskId：
  - contextVersion：
  - projectFileSha256：
  - commanderTaskId：
- authorized：
- decision：

### handoff-02

- registryRef：
  - path：`public-skills/registry.json`
  - versionOrHash：
  - sha256：
  - readAt：
- publicSkillId：`public.taobao-ecommerce-image-set`
- capabilityId：`taobao-ecommerce`
- maturity：
- allowedOrganizations：
- controllerTaskAuthorizationRef：
  - enterpriseId：
  - businessProjectId：
  - taskId：
  - contextVersion：
  - projectFileSha256：
  - commanderTaskId：
- authorized：
- decision：

决策规则：运行时从根登记表原字节和当前 `project.json` 重新计算。只有 `maturity === operational`、`allowedOrganizations` 包含 `ai-brand-officer`、`project.json.publicSkillIds` 包含目标公共 Skill，且 `commanderTaskId` 与可信 `visualPolicyContext` 一致时，`authorized = true`、`decision = allow-formal-execution`；三项授权缺一，候选直接拒绝。候选自报授权不是可信依据。

## productionBoundary

- 概念、可编辑性和正式资产：
- 施工、结构、消防与电气：
- 包装法规、刀模与印刷：
- 商标法律：
- 发布与版本切换：

## ruleReview

- reviewId：
- reviewerId：（必须与视觉专业审核不同）
- reviewerRole：`rule-engine`
- reviewedAt：
- candidateHash：
- planHash：
- evidenceHash：
- hardVetoes：
- failedCriteria：
- 结论：

## professionalReview

- reviewId：
- reviewerId：（必须与规则审核不同）
- reviewerRole：`brand-professional-reviewer`
- reviewedAt：
- candidateHash：
- planHash：
- evidenceHash：
- 独立审核只读：task、evidence、candidate、rubric
- 定位承接：
- 区别度：
- 识别与延展：
- 产品原貌：
- 精确文字：
- 授权：
- 系列一致：
- 生产边界：
- 视觉 DNA 对照：
- 结论与失败项：

## eliminationAndReworkHistory

- 淘汰候选与原因：
- 根因代码：
- 第一轮局部修正：
- 第二轮模块重做：
- 第三轮方法或路径切换：

## humanSummary

- 结论：
- 依据：
- 实际执行模块：
- 推荐候选与淘汰原因：
- 限制、风险与未知：
- 必要下一步：

## systemPackage（由正式 packager 自动封装，不手填）

- schemaVersion：
- artifactVersion：
- artifactStatus：
- lifecycleStatus：
- taskIdentity：
- skillId：`brand-visual`
- selectedModuleIds：
- candidateId：
- planHash：
- evidenceHash：
- candidateHash：
- reviewHash：
- debugStateHash：
- baseCandidateHash：
- executionContextCommitment：
- deliveryContextCommitment：
- output：
  - candidateId：
  - candidateHash：
  - contentSha256：
  - contentJson：
- evidenceRefs：
- upstreamArtifacts：
- review：
- businessContent：
- downstreamInstructions：
  - mustPreserve：
  - mayAdapt：
  - forbiddenChanges：
- eliminationAndReworkHistory：
- nextOrganizationRecommendation：
- debugTrace：

## deliverableEnvelope（由正式 packager 自动封装，不手填）

- humanSummary：
- systemPackage：
- sha256：（正式包顶层字段）

禁止出现顶层或 `systemPackage` 内的未知 `packageHash`。
