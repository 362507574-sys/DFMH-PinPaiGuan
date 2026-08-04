import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  stableSha256,
} from "../scripts/brand_contracts.mjs";
import {
  computeBrandCommunicationPolicyContext,
  runBrandSkillRuntime,
} from "../scripts/brand_skill_runtime.mjs";
import {
  POSTER_COMPARISON_CHECK_IDS,
  POSTER_DIMENSION_WEIGHTS,
  scorePosterCandidate,
} from "../scripts/brand_quality_gate.mjs";
import {
  createKnowledgeContext,
} from "../../../scripts/feishu-commander/knowledge_context.mjs";
import {
  makeBrandRuntimeFixture,
} from "./helpers/brand_runtime_fixture.mjs";

const RULE_REVIEWER_ID = "reviewer-rule-e2e";
const PROFESSIONAL_REVIEWER_ID = "reviewer-professional-e2e";
const BRAND_ID = "brand-e2e";
const POSTER_SKILL_ID = "public.promotional-poster";
const POSTER_REGISTRY_PATH = "public-skills/registry.json";
const FIXED_TIME = "2026-07-30T00:00:00.000Z";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function claimDigest(value) {
  return sha256(Buffer.from(
    value.normalize("NFKC").trim().replace(/\s+/gu, " "),
    "utf8",
  ));
}

async function assertReturnedCandidate(fixture, result, taskId) {
  assert.equal(result.status, "returned_to_control_center");
  assert.equal(result.outcome, "candidate_ready");
  assert.match(result.deliverablePath, new RegExp(taskId, "u"));
  assert.doesNotMatch(result.deliverablePath, /shared-artifacts|outputs/iu);
  const stored = JSON.parse(await fs.readFile(
    path.resolve(fixture.projectRoot, result.deliverablePath),
    "utf8",
  ));
  assert.deepEqual(stored, result.deliverable);
}

function hashedCandidate(identity, skillId, candidateId, content) {
  const candidate = {
    candidateId,
    taskId: identity.taskId,
    enterpriseId: identity.enterpriseId,
    businessProjectId: identity.businessProjectId,
    skillId,
    content,
  };
  return {
    ...candidate,
    candidateHash: stableSha256(candidate),
  };
}

function passingReview(index, affectedModuleIds) {
  return {
    ruleReview: {
      reviewId: `rule-review-${index}`,
      reviewerId: RULE_REVIEWER_ID,
      reviewerRole: "rule-engine",
      passed: true,
      failedCriteria: [],
      hardVetoes: [],
    },
    professionalReview: {
      reviewId: `professional-review-${index}`,
      reviewerId: PROFESSIONAL_REVIEWER_ID,
      reviewerRole: "brand-professional-reviewer",
      passed: true,
      score: 92,
      observations: ["候选已通过独立专业审核。"],
      correctionTargets: [],
    },
    affectedModuleIds,
    requiresBusinessDecision: false,
    blockedReason: "",
    remainingRisks: [],
    requestedBusinessInput: [],
  };
}

function posterVetoReview(index, affectedModuleIds, assessments) {
  const assessment = scorePosterCandidate({
    candidateId: `poster-assessment-${index}`,
    hardVetoes: ["precise-text-error"],
    dimensions: { ...POSTER_DIMENSION_WEIGHTS },
    comparisonChecks: POSTER_COMPARISON_CHECK_IDS.map((checkId) => ({
      checkId,
      passed: true,
      observation: `${checkId} 已按固定方法通过。`,
    })),
  });
  assessments.push(assessment);
  const [ruleTrace, professionalTrace] = assessment.reviewTrace;
  return {
    ruleReview: {
      reviewId: `poster-veto-rule-${index}`,
      reviewerId: RULE_REVIEWER_ID,
      reviewerRole: "rule-engine",
      passed: ruleTrace.passed,
      failedCriteria: ruleTrace.failedCriteria,
      hardVetoes: ruleTrace.hardVetoes,
    },
    professionalReview: {
      reviewId: `poster-perfect-professional-${index}`,
      reviewerId: PROFESSIONAL_REVIEWER_ID,
      reviewerRole: "brand-professional-reviewer",
      passed: professionalTrace.passed,
      score: professionalTrace.score,
      observations: professionalTrace.observations,
      correctionTargets: professionalTrace.correctionTargets,
    },
    affectedModuleIds,
    requiresBusinessDecision: false,
    blockedReason: "",
    remainingRisks: ["精确文字仍错误，禁止交付。"],
    requestedBusinessInput: [],
  };
}

async function makeCoreSkillsRuntimeFixture(t) {
  const fixture = await makeBrandRuntimeFixture(t);
  let contextVersion = 1;
  let publicSkillIds = [];
  let projectFileBytes;
  let registryBytes;
  let registrySha256;

  async function writeProject() {
    const projectRecord = {
      ...fixture.projectRecord,
      contextVersion,
      publicSkillIds,
      updatedAt: FIXED_TIME,
    };
    projectFileBytes = Buffer.from(
      `${JSON.stringify(projectRecord, null, 2)}\n`,
      "utf8",
    );
    await fs.writeFile(fixture.projectFile, projectFileBytes);
    return {
      projectRecord,
      projectFileSha256: sha256(projectFileBytes),
    };
  }

  async function writePublicRegistry() {
    const registry = {
      schemaVersion: 1,
      publicSkills: [{
        id: POSTER_SKILL_ID,
        displayName: "普通宣传海报",
        capabilityId: "promotional-poster",
        maturity: "operational",
        allowedOrganizations: ["ai-brand-officer"],
        defaultPrimaryOrganization: "ai-brand-officer",
      }],
    };
    registryBytes = Buffer.from(
      `${JSON.stringify(registry, null, 2)}\n`,
      "utf8",
    );
    registrySha256 = sha256(registryBytes);
    const registryFile = path.join(fixture.projectRoot, POSTER_REGISTRY_PATH);
    await fs.mkdir(path.dirname(registryFile), { recursive: true });
    await fs.writeFile(registryFile, registryBytes);
  }

  async function setControlContext({
    nextContextVersion,
    nextPublicSkillIds = publicSkillIds,
  }) {
    contextVersion = nextContextVersion;
    publicSkillIds = [...nextPublicSkillIds];
    return writeProject();
  }

  async function makeReceipt(taskId, skillId, status = "no_hit") {
    const receiptPath = [
      "business-projects",
      fixture.enterpriseId,
      fixture.businessProjectId,
      "organizations",
      "ai-brand-officer",
      "tasks",
      taskId,
      "evidence",
      "knowledge",
      "knowledge_context.json",
    ].join("/");
    const receipt = createKnowledgeContext({
      schemaVersion: 1,
      requestId: taskId,
      generatedAt: FIXED_TIME,
      status,
      taskSummary: `Task10 real E2E receipt for ${skillId}.`,
      capabilityId: skillId,
      spaces: [
        { name: "老雷知识库", spaceId: "space-laolei" },
        { name: "老雷课件知识库", spaceId: "space-courseware" },
      ],
      queries: [skillId],
      sources: [],
      unreadCandidates: [],
      degradedReason: status === "degraded"
        ? "Knowledge service unavailable during this bounded test."
        : "",
    });
    const receiptBytes = Buffer.from(JSON.stringify(receipt, null, 2), "utf8");
    const receiptFile = path.resolve(fixture.projectRoot, receiptPath);
    await fs.mkdir(path.dirname(receiptFile), { recursive: true });
    await fs.writeFile(receiptFile, receiptBytes);
    return {
      receiptPath,
      receiptSha256: sha256(receiptBytes),
    };
  }

  function artifactRef(result, artifactId, version) {
    assert.equal(result.status, "returned_to_control_center");
    assert.equal(result.outcome, "candidate_ready");
    return Object.freeze({
      artifactId,
      version,
      sha256: result.deliverable.sha256,
      sourceOrganizationId: "ai-brand-officer",
    });
  }

  await writePublicRegistry();
  await writeProject();
  return {
    ...fixture,
    get contextVersion() {
      return contextVersion;
    },
    get publicSkillIds() {
      return [...publicSkillIds];
    },
    get registrySha256() {
      return registrySha256;
    },
    get projectFileSha256() {
      return sha256(projectFileBytes);
    },
    setControlContext,
    makeReceipt,
    artifactRef,
  };
}

async function runCase({
  fixture,
  taskId,
  skillId,
  goal,
  requestedModuleIds,
  readableArtifacts,
  conversationFacts,
  candidateFactory,
  reviewFactory = ({ index }) => passingReview(index, requestedModuleIds),
  brandId,
  visualPolicyContext,
}) {
  const identity = {
    enterpriseId: fixture.enterpriseId,
    businessProjectId: fixture.businessProjectId,
    taskId,
  };
  const receiptBinding = await fixture.makeReceipt(taskId, skillId);
  let executeCount = 0;
  let reviewCount = 0;
  let clock = 0;
  const request = {
    taskIdentity: identity,
    skillId,
    goal,
    requestedModuleIds,
    availableInputs: {},
    constraints: {},
    conversationFacts,
    publicSources: [],
    professionalJudgments: [{
      id: `judgment-${taskId}`,
      category: "professional-judgment",
      claim: "独立审核必须按当前任务证据和固定版本执行。",
      sourceRef: "brand-officer:e2e-review",
      confidence: "supported",
    }],
    criticalUnknowns: [],
  };
  const trusted = {
    projectRoot: fixture.projectRoot,
    projectContext: {
      schemaVersion: 1,
      taskId,
      enterpriseId: fixture.enterpriseId,
      businessProjectId: fixture.businessProjectId,
      projectContextVersion: fixture.contextVersion,
      readableArtifacts,
    },
    receiptBinding,
    async executeModules(input) {
      executeCount += 1;
      return candidateFactory({
        identity,
        executeCount,
        selectedModuleIds: input.plan.selectedModuleIds,
      });
    },
    async reviewCandidate(input) {
      reviewCount += 1;
      return reviewFactory({
        index: reviewCount,
        reviewInput: input,
      });
    },
    reviewerBindings: {
      ruleReviewerId: RULE_REVIEWER_ID,
      professionalReviewerId: PROFESSIONAL_REVIEWER_ID,
    },
    now() {
      const result = new Date(Date.parse(FIXED_TIME) + clock * 1000);
      clock += 1;
      return result;
    },
  };
  if (skillId === "brand-visual") {
    trusted.brandId = brandId ?? BRAND_ID;
    trusted.visualPolicyContext = visualPolicyContext ?? {
      schemaVersion: 1,
      projectContextVersion: fixture.contextVersion,
      commanderTaskId: fixture.projectRecord.commanderTaskId,
    };
  }
  const result = await runBrandSkillRuntime(request, trusted);
  return {
    result,
    executeCount,
    reviewCount,
    request,
    trusted,
  };
}

function positioningCandidate({ identity, executeCount }) {
  return hashedCandidate(
    identity,
    "brand-positioning",
    `positioning-candidate-${executeCount}`,
    {
      sections: [{
        sectionId: "single-mindshare",
        content: "让餐饮老板今天看懂今天的经营。",
      }],
    },
  );
}

function makeVisualContent({
  fixture,
  identity,
  selectedModuleIds,
  executeCount,
  includePosterHandoff = true,
  aestheticProjectId = fixture.businessProjectId,
  importSnapshotRef = null,
}) {
  const suffix = String(executeCount).padStart(2, "0");
  const publicCapabilityHandoffs = includePosterHandoff
    ? [{
      registryRef: {
        path: POSTER_REGISTRY_PATH,
        versionOrHash: `sha256:${fixture.registrySha256}`,
        sha256: fixture.registrySha256,
        readAt: FIXED_TIME,
      },
      publicSkillId: POSTER_SKILL_ID,
      capabilityId: "promotional-poster",
      maturity: "operational",
      allowedOrganizations: ["ai-brand-officer"],
      controllerTaskAuthorizationRef: {
        enterpriseId: identity.enterpriseId,
        businessProjectId: identity.businessProjectId,
        taskId: identity.taskId,
        contextVersion: fixture.contextVersion,
        projectFileSha256: fixture.projectFileSha256,
        commanderTaskId: fixture.projectRecord.commanderTaskId,
      },
      authorized: true,
      decision: "allow-formal-execution",
    }]
    : [];
  return {
    schemaVersion: 1,
    brandId: BRAND_ID,
    selectedModuleIds,
    directionCandidates: [
      { directionId: "direction-01", imageSha256: sha256(`01-${suffix}`) },
      { directionId: "direction-02", imageSha256: sha256(`02-${suffix}`) },
      { directionId: "direction-03", imageSha256: sha256(`03-${suffix}`) },
    ],
    pairwiseDifferenceEvidence: [
      {
        directionIds: ["direction-01", "direction-02"],
        dimensions: ["composition", "lighting"],
      },
      {
        directionIds: ["direction-01", "direction-03"],
        dimensions: ["color", "typography"],
      },
      {
        directionIds: ["direction-02", "direction-03"],
        dimensions: ["material", "whitespace"],
      },
    ],
    aestheticProfileRef: {
      enterpriseId: identity.enterpriseId,
      businessProjectId: aestheticProjectId,
      brandId: BRAND_ID,
      artifactId: "aesthetic-profile",
      version: 1,
      sha256: "d".repeat(64),
      importSnapshotRef,
    },
    publicCapabilityHandoffs,
  };
}

function visualCandidate(options) {
  const {
    fixture,
    identity,
    executeCount,
    selectedModuleIds,
  } = options;
  return hashedCandidate(
    identity,
    "brand-visual",
    `visual-candidate-${executeCount}`,
    makeVisualContent({
      ...options,
      fixture,
      identity,
      executeCount,
      selectedModuleIds,
    }),
  );
}

function communicationFacts() {
  return [
    ["fact-core", "今天的经营，今天看懂。", "message-core"],
    ["fact-support", "先看清经营信号，再由老板作出决定。", "message-support"],
    ["fact-trust", "产品能力与品牌起源均有当前项目证据。", "message-trust"],
    ["fact-pillar", "长期解释每天值得关注的经营问题。", "pillar-operating-clarity"],
    ["fact-product", "AI产品提供菜单毛利分析。", "product-margin-analysis"],
    ["fact-origin", "品牌起源是帮助餐饮老板更早看懂经营问题。", "story-origin"],
    ["fact-founder", "创始人当前公开身份是产品主理人。", "founder-identity"],
  ].map(([id, claim, claimKey]) => ({
    id,
    claim,
    claimKey,
    sourceRef: `conversation:${id}`,
    confidence: "confirmed",
  }));
}

function confirmedClaim(claimKey, claim, evidenceId) {
  return {
    claimKey,
    claim,
    claimDigest: claimDigest(claim),
    evidenceIds: [evidenceId],
    status: "confirmed",
  };
}

function communicationContent(visualArtifact, {
  visualBinding = visualArtifact,
} = {}) {
  return {
    messageHierarchy: {
      coreMessage: confirmedClaim(
        "message-core",
        "今天的经营，今天看懂。",
        "fact-core",
      ),
      supportMessages: [confirmedClaim(
        "message-support",
        "先看清经营信号，再由老板作出决定。",
        "fact-support",
      )],
      trustReasons: [confirmedClaim(
        "message-trust",
        "产品能力与品牌起源均有当前项目证据。",
        "fact-trust",
      )],
    },
    contentPillars: [{
      pillarId: "pillar-001",
      title: "经营看懂",
      purpose: "长期解释每天值得关注的经营问题。",
      claimKey: "pillar-operating-clarity",
      claimDigest: claimDigest("长期解释每天值得关注的经营问题。"),
      evidenceIds: ["fact-pillar"],
      status: "confirmed",
    }],
    proofLibrary: [{
      proofId: "proof-001",
      claimKey: "product-margin-analysis",
      claim: "AI产品提供菜单毛利分析。",
      claimDigest: claimDigest("AI产品提供菜单毛利分析。"),
      evidenceIds: ["fact-product"],
      status: "confirmed",
    }],
    brandStory: {
      status: "confirmed",
      narrative: "品牌从帮助餐饮老板更早看懂经营问题开始。",
      claims: [confirmedClaim(
        "story-origin",
        "品牌起源是帮助餐饮老板更早看懂经营问题。",
        "fact-origin",
      )],
    },
    founderIpPosition: {
      status: "provisional",
      position: "餐饮经营问题的产品讲解者。",
      viewpointBoundaries: ["不自称行业第一，不承诺经营结果。"],
      claims: [{
        claimKey: "founder-identity",
        claim: "创始人当前公开身份是产品主理人。",
        claimDigest: null,
        evidenceIds: ["fact-founder"],
        status: "provisional",
      }],
    },
    campaignMotherIdea: {
      status: "not-applicable",
      theme: "本次未调用",
      idea: "本次未调用",
      factualClaims: [],
    },
    toneAndVoice: {
      principles: ["清楚、克制、有证据"],
      preferredTerms: ["经营参考"],
      forbiddenTerms: ["保证增长"],
    },
    forbiddenClaims: ["行业第一", "保证增长", "保证成交"],
    visualBindings: {
      status: "bound",
      artifactRefs: [{ ...visualBinding }],
    },
    channelAdaptationBoundary: {
      brandOfficer: "AI品牌官负责品牌信息母体、内容母题、原则、证据、禁区和重大品牌传播。",
      growthStrategist: "AI增长战略官负责小红书、短视频、公众号、私域的选题、节奏、运营、投流与获客。",
      dealOfficer: "AI成交官负责销售沟通、成交话术、成交脚本和成交策略。",
    },
  };
}

test("positioning, visual and communication pass exact-version runtime handoffs", async (t) => {
  const fixture = await makeCoreSkillsRuntimeFixture(t);
  const positioningRun = await runCase({
    fixture,
    taskId: "task-positioning-e2e",
    skillId: "brand-positioning",
    goal: "完成品类、用户、差异化和单一心智占位定位",
    requestedModuleIds: [
      "category-positioning",
      "audience-positioning",
      "differentiation-positioning",
      "mindshare-occupation",
    ],
    readableArtifacts: [],
    conversationFacts: [{
      id: "positioning-fact",
      claim: "产品帮助餐饮老板理解经营信号。",
      sourceRef: "conversation:positioning",
      confidence: "confirmed",
    }],
    candidateFactory: positioningCandidate,
  });
  const positioning = positioningRun.result;
  await assertReturnedCandidate(
    fixture,
    positioning,
    "task-positioning-e2e",
  );
  assert.deepEqual(positioning.deliverable.systemPackage.upstreamArtifacts, []);
  assert.equal(positioning.deliverable.systemPackage.policyContextHash, null);

  const positioningRef = fixture.artifactRef(
    positioning,
    "brand-positioning-v2",
    1,
  );
  await fixture.setControlContext({
    nextContextVersion: 2,
    nextPublicSkillIds: [POSTER_SKILL_ID],
  });
  const visualRun = await runCase({
    fixture,
    taskId: "task-visual-e2e",
    skillId: "brand-visual",
    goal: "制作单张临时活动海报并探索AI视觉主体",
    requestedModuleIds: [
      "poster-art-direction",
      "ai-visual-generation",
    ],
    readableArtifacts: [positioningRef],
    conversationFacts: [{
      id: "visual-fact",
      claim: "帝王确认临时海报用途和三个视觉方向。",
      sourceRef: "conversation:visual",
      confidence: "confirmed",
    }],
    candidateFactory: (input) => visualCandidate({ fixture, ...input }),
  });
  const visual = visualRun.result;
  await assertReturnedCandidate(fixture, visual, "task-visual-e2e");
  assert.deepEqual(
    visual.deliverable.systemPackage.upstreamArtifacts,
    [positioningRef],
  );
  assert.equal(
    visual.deliverable.systemPackage.policyContextHash,
    stableSha256({
      brandId: BRAND_ID,
      visualPolicyContext: {
        schemaVersion: 1,
        projectContextVersion: 2,
        commanderTaskId: fixture.projectRecord.commanderTaskId,
      },
    }),
  );
  assert.equal(visual.candidate.content.directionCandidates.length, 3);

  const visualRef = fixture.artifactRef(visual, "brand-visual-v2", 1);
  await fixture.setControlContext({
    nextContextVersion: 3,
    nextPublicSkillIds: [POSTER_SKILL_ID],
  });
  const communicationRun = await runCase({
    fixture,
    taskId: "task-communication-e2e",
    skillId: "brand-communication",
    goal: "建立品牌信息母体、内容母题并绑定视觉",
    requestedModuleIds: ["content-communication"],
    readableArtifacts: [positioningRef, visualRef],
    conversationFacts: communicationFacts(),
    candidateFactory: ({ identity, executeCount }) => hashedCandidate(
      identity,
      "brand-communication",
      `communication-candidate-${executeCount}`,
      communicationContent(visualRef),
    ),
  });
  const communication = communicationRun.result;
  await assertReturnedCandidate(
    fixture,
    communication,
    "task-communication-e2e",
  );
  assert.deepEqual(
    communication.deliverable.systemPackage.upstreamArtifacts,
    [positioningRef, visualRef],
  );
  assert.equal(
    communication.deliverable.systemPackage.policyContextHash,
    (await computeBrandCommunicationPolicyContext()).policyContextHash,
  );
  assert.deepEqual(
    Object.keys(communication.candidate.content)
      .filter((field) => field !== "_brandDeliveryContextCommitment"),
    [
      "messageHierarchy",
      "contentPillars",
      "proofLibrary",
      "brandStory",
      "founderIpPosition",
      "campaignMotherIdea",
      "toneAndVoice",
      "forbiddenClaims",
      "visualBindings",
      "channelAdaptationBoundary",
    ],
  );
  assert.equal(
    communication.candidate.content.messageHierarchy.coreMessage.claimDigest,
    claimDigest("今天的经营，今天看懂。"),
  );
});

test("changed upstream hash is rejected by the real communication semantic gate", async (t) => {
  const fixture = await makeCoreSkillsRuntimeFixture(t);
  await fixture.setControlContext({ nextContextVersion: 3 });
  const positioningRef = {
    artifactId: "brand-positioning-v2",
    version: 1,
    sha256: "a".repeat(64),
    sourceOrganizationId: "ai-brand-officer",
  };
  const visualRef = {
    artifactId: "brand-visual-v2",
    version: 1,
    sha256: "b".repeat(64),
    sourceOrganizationId: "ai-brand-officer",
  };
  const run = await runCase({
    fixture,
    taskId: "task-communication-drift",
    skillId: "brand-communication",
    goal: "建立品牌信息母体并绑定视觉",
    requestedModuleIds: ["content-communication"],
    readableArtifacts: [positioningRef, visualRef],
    conversationFacts: communicationFacts(),
    candidateFactory: ({ identity }) => hashedCandidate(
      identity,
      "brand-communication",
      "communication-stale-upstream",
      communicationContent(visualRef, {
        visualBinding: {
          ...visualRef,
          sha256: "f".repeat(64),
        },
      }),
    ),
  });
  assert.equal(run.result.status, "returned_to_control_center");
  assert.equal(run.result.outcome, "blocked");
  assert.equal(run.result.deliverable, null);
  assert.match(
    run.result.diagnostic.blockedReason,
    /exact trusted brand-visual artifact|semantic validation/iu,
  );
});

test("cross-project trusted context is rejected before downstream execution", async (t) => {
  const fixture = await makeCoreSkillsRuntimeFixture(t);
  const identity = {
    enterpriseId: fixture.enterpriseId,
    businessProjectId: fixture.businessProjectId,
    taskId: "task-cross-project",
  };
  const receiptBinding = await fixture.makeReceipt(
    identity.taskId,
    "brand-visual",
  );
  await assert.rejects(
    runBrandSkillRuntime({
      taskIdentity: identity,
      skillId: "brand-visual",
      goal: "制作海报",
      requestedModuleIds: ["poster-art-direction"],
      availableInputs: {},
      constraints: {},
      conversationFacts: [],
      publicSources: [],
      professionalJudgments: [],
      criticalUnknowns: [],
    }, {
      projectRoot: fixture.projectRoot,
      projectContext: {
        schemaVersion: 1,
        taskId: identity.taskId,
        enterpriseId: fixture.enterpriseId,
        businessProjectId: "different-project",
        projectContextVersion: 1,
        readableArtifacts: [],
      },
      receiptBinding,
      brandId: BRAND_ID,
      visualPolicyContext: {
        schemaVersion: 1,
        projectContextVersion: 1,
        commanderTaskId: fixture.projectRecord.commanderTaskId,
      },
      async executeModules() {
        assert.fail("cross-project context must fail before execution");
      },
      async reviewCandidate() {
        assert.fail("cross-project context must fail before review");
      },
      reviewerBindings: {
        ruleReviewerId: RULE_REVIEWER_ID,
        professionalReviewerId: PROFESSIONAL_REVIEWER_ID,
      },
      now: () => new Date(FIXED_TIME),
    }),
    /businessProjectId.*does not match|project context.*identity/iu,
  );
});

test("brand visual fails closed when the exact positioning artifact is absent", async (t) => {
  const fixture = await makeCoreSkillsRuntimeFixture(t);
  await assert.rejects(
    runCase({
      fixture,
      taskId: "task-visual-no-positioning",
      skillId: "brand-visual",
      goal: "建立长期品牌视觉体系",
      requestedModuleIds: ["visual-identity-system"],
      readableArtifacts: [],
      conversationFacts: [],
      candidateFactory: (input) => visualCandidate({ fixture, ...input }),
    }),
    /brand-positioning.*artifact/iu,
  );
});

test("content and campaign communication both require an exact visual artifact", async (t) => {
  for (const [suffix, goal, requestedModuleIds] of [
    ["content", "建立品牌信息母体", ["content-communication"]],
    ["campaign", "策划周年品牌营销活动", ["brand-campaign"]],
  ]) {
    const fixture = await makeCoreSkillsRuntimeFixture(t);
    const positioningRef = {
      artifactId: "brand-positioning-v2",
      version: 1,
      sha256: "a".repeat(64),
      sourceOrganizationId: "ai-brand-officer",
    };
    await assert.rejects(
      runCase({
        fixture,
        taskId: `task-communication-no-visual-${suffix}`,
        skillId: "brand-communication",
        goal,
        requestedModuleIds,
        readableArtifacts: [positioningRef],
        conversationFacts: communicationFacts(),
        candidateFactory: ({ identity }) => hashedCandidate(
          identity,
          "brand-communication",
          `candidate-no-visual-${suffix}`,
          {},
        ),
      }),
      /brand-visual.*artifact/iu,
    );
  }
});

test("cross-project aesthetic profile without a fixed import snapshot is blocked", async (t) => {
  const fixture = await makeCoreSkillsRuntimeFixture(t);
  await fixture.setControlContext({
    nextContextVersion: 2,
    nextPublicSkillIds: [POSTER_SKILL_ID],
  });
  const positioningRef = {
    artifactId: "brand-positioning-v2",
    version: 1,
    sha256: "a".repeat(64),
    sourceOrganizationId: "ai-brand-officer",
  };
  const run = await runCase({
    fixture,
    taskId: "task-visual-cross-aesthetic",
    skillId: "brand-visual",
    goal: "制作海报",
    requestedModuleIds: ["poster-art-direction"],
    readableArtifacts: [positioningRef],
    conversationFacts: [],
    candidateFactory: (input) => visualCandidate({
      fixture,
      ...input,
      aestheticProjectId: "other-brand-project",
      importSnapshotRef: null,
    }),
  });
  assert.equal(run.result.outcome, "blocked");
  assert.equal(run.result.deliverablePath, null);
  assert.match(
    run.result.diagnostic.blockedReason,
    /cross-project aesthetic profile requires a fixed import snapshot/iu,
  );
});

test("public poster Skill without project control-center authorization is blocked", async (t) => {
  const fixture = await makeCoreSkillsRuntimeFixture(t);
  await fixture.setControlContext({
    nextContextVersion: 2,
    nextPublicSkillIds: [],
  });
  const positioningRef = {
    artifactId: "brand-positioning-v2",
    version: 1,
    sha256: "a".repeat(64),
    sourceOrganizationId: "ai-brand-officer",
  };
  const run = await runCase({
    fixture,
    taskId: "task-visual-no-public-auth",
    skillId: "brand-visual",
    goal: "制作海报",
    requestedModuleIds: ["poster-art-direction"],
    readableArtifacts: [positioningRef],
    conversationFacts: [],
    candidateFactory: (input) => visualCandidate({ fixture, ...input }),
  });
  assert.equal(run.result.outcome, "blocked");
  assert.equal(run.result.deliverable, null);
  assert.match(
    run.result.diagnostic.blockedReason,
    /lacks registry, organization, or project publicSkillIds authorization/iu,
  );
});

test("poster hard veto survives a perfect professional score through three real reworks and never packages", async (t) => {
  const fixture = await makeCoreSkillsRuntimeFixture(t);
  const posterAssessments = [];
  await fixture.setControlContext({
    nextContextVersion: 2,
    nextPublicSkillIds: [POSTER_SKILL_ID],
  });
  const positioningRef = {
    artifactId: "brand-positioning-v2",
    version: 1,
    sha256: "a".repeat(64),
    sourceOrganizationId: "ai-brand-officer",
  };
  const run = await runCase({
    fixture,
    taskId: "task-poster-hard-veto",
    skillId: "brand-visual",
    goal: "制作海报",
    requestedModuleIds: ["poster-art-direction"],
    readableArtifacts: [positioningRef],
    conversationFacts: [],
    candidateFactory: (input) => visualCandidate({ fixture, ...input }),
    reviewFactory: ({ index }) => posterVetoReview(
      index,
      ["poster-art-direction"],
      posterAssessments,
    ),
  });
  assert.equal(run.result.status, "returned_to_control_center");
  assert.equal(run.result.outcome, "blocked");
  assert.equal(run.result.deliverable, null);
  assert.equal(run.result.deliverablePath, null);
  assert.equal(run.executeCount, 4);
  assert.equal(run.reviewCount, 4);
  assert.equal(posterAssessments.length, 4);
  assert.ok(posterAssessments.every((assessment) => (
    assessment.score === 100
    && assessment.verdict === "eliminated"
    && assessment.hardVetoes.includes("precise-text-error")
  )));
  assert.equal(run.result.debugState.attemptedCorrections.length, 3);
  assert.equal(
    run.result.debugState.timeline.filter(
      ({ eventType }) => eventType === "review-failed",
    ).length,
    4,
  );
  const rootCauseCodes = run.result.debugState.blockedReport
    .attemptedCorrections.map(({ rootCauseCode }) => rootCauseCode);
  assert.equal(new Set(rootCauseCodes).size, 1);
  assert.match(rootCauseCodes[0], /^cause-[a-f0-9]{16}$/u);
});
