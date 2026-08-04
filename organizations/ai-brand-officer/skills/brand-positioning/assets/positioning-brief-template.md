# 品牌定位候选简报

## taskIdentity

- enterpriseId：
- businessProjectId：
- taskId：
- skillId：`brand-positioning`
- candidateVersion：
- candidateSha256：
- status：

## selectedModuleIds

- 已选择：
- 本次未调用：
- 选择理由与依赖：

## upstreamArtifacts

| artifactId | version | sha256 | 用途 |
| --- | --- | --- | --- |
|  |  |  |  |

## 事实、推断、假设和未知

### 事实

### 推断

### 假设

### 证据与未知项

## evidenceMap

| claimId | 关键主张 | 分类（事实/推断/假设/未知） | sourceId | 限制与验证 |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

## 品类定位

## 首要用户与非首要用户

## 场景、动机、阻力与实际替代

## 竞争心智

## 差异化价值与证据

## 品牌定位陈述

## 核心价值主张与信任理由

## primaryMindshare

- 唯一主要心智：
- 辅助认知：

## nonTargetMindshare

## 品牌架构

## 名称与口号候选及风险

## 定位验证

## 品牌视觉与品牌传播战略简报

## 风险、待确认项与停止条件

## ruleReview

- reviewId：
- reviewerId：（必须与专业审核不同）
- reviewerRole：`rule-engine`
- reviewedAt：
- candidateHash：（必须与专业审核相同）
- planHash：（必须与专业审核相同）
- evidenceHash：（必须与专业审核相同）
- 结论：
- 失败项：

## professionalReview

- reviewId：
- reviewerId：（必须与规则审核不同）
- reviewerRole：`brand-professional-reviewer`
- reviewedAt：
- candidateHash：（必须与规则审核相同）
- planHash：（必须与规则审核相同）
- evidenceHash：（必须与规则审核相同）
- 独立审核只读：task、evidence、candidate、rubric；不读取执行者说明或自评
- 品类可理解：
- 用户具体：
- 差异可持续：
- 证据可追溯：
- 单一心智：
- 可指导视觉与传播：
- 结论与失败项：

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
- skillId：`brand-positioning`
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
  - contentJson：（规范 JSON；承载定位专业正文、evidenceMap、primaryMindshare、nonTargetMindshare、quality、ruleReview、professionalReview）
- evidenceRefs：
- upstreamArtifacts：
- review：
  - candidateId：
  - verdict：
  - score：
  - hardVetoes：
  - failedCriteria：
  - correctionTargets：
  - reviewHash：
- businessContent：
  - facts：
  - judgments：
  - assumptions：
  - unknowns：
  - businessConclusion：
  - recommendedCandidate：
  - confirmedConclusions：
  - riskNotes：
  - decisionRequests：
- downstreamInstructions：
  - mustPreserve：
  - mayAdapt：
  - forbiddenChanges：
- eliminationAndReworkHistory：
- nextOrganizationRecommendation：
- debugTrace：
  - status：
  - revision：
  - stateHash：
  - stateSha256：
  - stateJson：
  - attemptedCorrectionCount：
  - timeline：
- packageHash：（映射正式包顶层 `sha256`，必须可由 humanSummary + systemPackage 重放）
