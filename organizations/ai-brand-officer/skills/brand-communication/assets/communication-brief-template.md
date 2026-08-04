# 品牌传播候选简报模板

## 任务与版本

```yaml
taskIdentity:
  enterpriseId:
  businessProjectId:
  taskId:
skillId: brand-communication
selectedModuleIds: []
skippedModuleIds: []
planHash:
evidenceHash:
upstreamArtifacts:
  - artifactId:
    version:
    sha256:
    sourceOrganizationId:
evidenceMap:
  facts: []
  judgments: []
  inferences: []
  assumptions: []
  unknowns: []
  forbiddenPublicInformation: []
```

## 传播业务内容

以下 `communicationContent` 恰好十个字段；未调用模块使用结构化“不适用”，不得删除字段或补造内容。

```yaml
communicationContent:
  messageHierarchy:
    coreMessage:
      claimKey:
      claim:
      claimDigest: null
      evidenceIds: []
      status: unknown
    supportMessages:
      - claimKey:
        claim:
        claimDigest: null
        evidenceIds: []
        status: unknown
    trustReasons:
      - claimKey:
        claim:
        claimDigest: null
        evidenceIds: []
        status: unknown
  contentPillars:
    - pillarId:
      title:
      purpose:
      claimKey:
      claimDigest: null
      evidenceIds: []
      status: unknown
  proofLibrary:
    - proofId:
      claimKey:
      claim:
      claimDigest: null
      evidenceIds: []
      status: unknown # confirmed | provisional | unknown
  brandStory:
    status: unknown # confirmed | provisional | unknown | not-applicable
    narrative:
    claims:
      - claimKey:
        claim:
        claimDigest: null
        evidenceIds: []
        status: unknown
  founderIpPosition:
    status: unknown # confirmed | provisional | unknown | not-applicable
    position:
    viewpointBoundaries: []
    claims:
      - claimKey:
        claim:
        claimDigest: null
        evidenceIds: []
        status: unknown
  campaignMotherIdea:
    status: not-applicable # confirmed | provisional | unknown | not-applicable
    theme:
    idea:
    factualClaims: []
  toneAndVoice:
    principles: []
    preferredTerms: []
    forbiddenTerms: []
  forbiddenClaims: []
  visualBindings:
    status: pending # bound | not-applicable | pending
    artifactRefs: []
  channelAdaptationBoundary:
    brandOfficer: AI品牌官负责品牌信息母体、内容母题、原则、证据、禁区和重大品牌传播。
    growthStrategist: AI增长战略官负责小红书、短视频、公众号、私域的选题、节奏、运营、投流与获客。
    dealOfficer: AI成交官负责销售沟通、成交话术、成交脚本和成交策略。
```

每个可确认主张都必须具有安全的 `claimKey`、`claimDigest`、`evidenceIds` 和 `status`，包括核心信息、支持信息、信任理由、内容母题、证明、故事分项、创始人分项和活动事实。`provisional` / `unknown` 可把 `claimDigest` 保持为 `null`；标为 `confirmed` 时必须填写小写 SHA-256。校验器分别把候选实际主张文本和每一条真实 `evidence.claim` 按 NFKC、首尾去空白、连续空白折叠后重新计算摘要，并强制“候选重算摘要 = 候选填写摘要 = 每一条绑定证据重算摘要”。候选自报摘要不能替代候选文本；不同文案即使借用正确证据摘要也拒绝，多条证据只要有一条表达不同事实也拒绝。缺少 `claimKey` 的证据不能确认；同一 `evidenceId` 不得跨不同 `claimKey` 复用。

所有传播任务都必须在 `upstreamArtifacts` 中绑定定位成果；选择 `content-communication` 或 `brand-campaign` 时还必须绑定视觉成果。仅选择品牌故事或创始人IP且视觉客观不适用时，`visualBindings.status` 才可为 `not-applicable` / `pending`，且 `artifactRefs` 必须为空。

`channelAdaptationBoundary` 固定说明：

- 增长战略官简报：只含必须保留的信息、可适配范围、证据、禁区和回传要求。
- AI品牌官提供品牌信息母体、内容母题、原则、证据和禁区，并负责重大品牌传播。
- AI增长战略官负责小红书、短视频、公众号、私域的选题、节奏、运营与获客；品牌官不制作小红书种草、短视频日更、公众号日常、私域运营或投流获客方案。
- AI成交官简报：只含事实锁、核心信息、语气、禁语和品牌一致性要求。
- AI成交官负责销售沟通、成交话术、成交脚本和成交策略；品牌官只提供事实锁、语气和禁语。

## 双审核

```yaml
ruleReview:
  reviewId:
  reviewerId:
  reviewerRole: rule-reviewer
  reviewedAt:
  candidateHash:
  planHash:
  evidenceHash:
  verdict:
  failedCriteria: []
  hardVetoes: []
professionalReview:
  reviewId:
  reviewerId:
  reviewerRole: professional-reviewer
  reviewedAt:
  candidateHash:
  planHash:
  evidenceHash:
  verdict:
  score:
  failedCriteria: []
  correctionTargets: []
```

两个 `reviewerId` 必须不同。

## 帝王版

```yaml
humanSummary:
  conclusion:
  basis: []
  limitations: []
  nextStep:
```

## 正式系统包映射

以下字段由公共运行时从受信计划、证据、候选、审核和调试状态生成；模板不得自报替代。

```yaml
systemPackage:
  schemaVersion: 1
  artifactVersion: 1
  artifactStatus: organization_candidate
  lifecycleStatus: candidate_ready
  taskIdentity:
  skillId: brand-communication
  selectedModuleIds: []
  candidateId:
  planHash:
  evidenceHash:
  candidateHash:
  reviewHash:
  debugStateHash:
  baseCandidateHash:
  executionContextCommitment:
  deliveryContextCommitment:
  policyContextHash:
  output:
    candidateId:
    candidateHash:
    contentSha256:
    contentJson:
  evidenceRefs: []
  upstreamArtifacts: []
  review:
  businessContent:
    facts: []
    judgments: []
    assumptions: []
    unknowns: []
    businessConclusion:
    recommendedCandidate:
    confirmedConclusions: []
    riskNotes: []
    decisionRequests: []
  downstreamInstructions:
    mustPreserve: []
    mayAdapt: []
    forbiddenChanges: []
  eliminationAndReworkHistory: []
  nextOrganizationRecommendation:
  debugTrace:
sha256:
```

候选仅返回总控；不得自行发布，不得写 `shared-artifacts/` 或 `outputs/`。
