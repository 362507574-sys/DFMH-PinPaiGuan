import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  stableSha256,
} from "../scripts/brand_contracts.mjs";
import {
  buildBrandEvidenceBundle,
} from "../scripts/brand_evidence_engine.mjs";
import {
  validateBrandDeliverablePackage,
} from "../scripts/brand_deliverable_packager.mjs";
import {
  runBrandSkillRuntime,
} from "../scripts/brand_skill_runtime.mjs";
import * as brandRuntimeModule from "../scripts/brand_skill_runtime.mjs";
import {
  buildBrandTaskPlan,
} from "../scripts/brand_task_planner.mjs";
import {
  createKnowledgeContext,
} from "../../../scripts/feishu-commander/knowledge_context.mjs";
import {
  makeBrandRuntimeFixture,
} from "./helpers/brand_runtime_fixture.mjs";

const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const VALIDATOR_PATH = path.resolve(
  TEST_ROOT,
  "..",
  "scripts",
  "brand_communication_semantic_validator.mjs",
);
const SCHEMA_PATH = path.resolve(
  TEST_ROOT,
  "..",
  "contracts",
  "brand-communication-candidate.schema.json",
);
const POSITIONING_ARTIFACT = Object.freeze({
  artifactId: "brand-positioning-v2",
  version: 2,
  sha256: "a".repeat(64),
  sourceOrganizationId: "ai-brand-officer",
});
const VISUAL_ARTIFACT = Object.freeze({
  artifactId: "brand-visual-v2",
  version: 3,
  sha256: "b".repeat(64),
  sourceOrganizationId: "ai-brand-officer",
});
const RULE_REVIEWER_ID = "reviewer-rule-communication";
const PROFESSIONAL_REVIEWER_ID = "reviewer-professional-communication";
const EXACT_CONTENT_FIELDS = Object.freeze([
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
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function semanticClaimDigest(value) {
  return sha256(Buffer.from(
    value.normalize("NFKC").trim().replace(/\s+/gu, " "),
    "utf8",
  ));
}

async function loadValidator() {
  try {
    return await import(pathToFileURL(VALIDATOR_PATH).href);
  } catch (error) {
    assert.fail(`brand communication semantic validator must exist: ${error.code ?? error.message}`);
  }
}

function baseContent() {
  return {
    messageHierarchy: {
      coreMessage: {
        claimKey: "message-core",
        claim: "今天的经营，今天看懂。",
        claimDigest: semanticClaimDigest("今天的经营，今天看懂。"),
        evidenceIds: ["fact-core"],
        status: "confirmed",
      },
      supportMessages: [{
        claimKey: "message-support",
        claim: "先看清经营信号，再由老板作出决定。",
        claimDigest: semanticClaimDigest("先看清经营信号，再由老板作出决定。"),
        evidenceIds: ["fact-support"],
        status: "confirmed",
      }],
      trustReasons: [{
        claimKey: "message-trust",
        claim: "产品能力与品牌起源均有当前项目证据。",
        claimDigest: semanticClaimDigest("产品能力与品牌起源均有当前项目证据。"),
        evidenceIds: ["fact-trust"],
        status: "confirmed",
      }],
    },
    contentPillars: [{
      pillarId: "pillar-001",
      title: "经营看懂",
      purpose: "长期解释每天值得关注的经营问题。",
      claimKey: "pillar-operating-clarity",
      claimDigest: semanticClaimDigest("长期解释每天值得关注的经营问题。"),
      evidenceIds: ["fact-pillar"],
      status: "confirmed",
    }],
    proofLibrary: [{
      proofId: "proof-001",
      claimKey: "product-margin-analysis",
      claim: "AI产品提供菜单毛利分析。",
      claimDigest: semanticClaimDigest("AI产品提供菜单毛利分析。"),
      evidenceIds: ["fact-product"],
      status: "confirmed",
    }],
    brandStory: {
      status: "confirmed",
      narrative: "品牌从帮助餐饮老板更早看懂经营问题开始。",
      claims: [{
        claimKey: "story-origin",
        claim: "品牌起源是帮助餐饮老板更早看懂经营问题。",
        claimDigest: semanticClaimDigest("品牌起源是帮助餐饮老板更早看懂经营问题。"),
        evidenceIds: ["fact-origin"],
        status: "confirmed",
      }],
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
      artifactRefs: [{ ...VISUAL_ARTIFACT }],
    },
    channelAdaptationBoundary: {
      brandOfficer: "AI品牌官负责品牌信息母体、内容母题、原则、证据、禁区和重大品牌传播。",
      growthStrategist: "AI增长战略官负责小红书、短视频、公众号、私域的选题、节奏、运营、投流与获客。",
      dealOfficer: "AI成交官负责销售沟通、成交话术、成交脚本和成交策略。",
    },
  };
}

function candidateFor(fixture, content = baseContent()) {
  const withoutHash = {
    candidateId: "candidate-communication-001",
    taskId: fixture.taskId,
    enterpriseId: fixture.enterpriseId,
    businessProjectId: fixture.businessProjectId,
    skillId: "brand-communication",
    content,
  };
  return {
    ...withoutHash,
    candidateHash: stableSha256(withoutHash),
  };
}

async function makeCommunicationCase(t, contentFactory = baseContent) {
  const fixture = await makeBrandRuntimeFixture(t);
  const receiptPath = [
    "business-projects",
    fixture.enterpriseId,
    fixture.businessProjectId,
    "organizations",
    "ai-brand-officer",
    "tasks",
    fixture.taskId,
    "evidence",
    "knowledge",
    "knowledge_context.json",
  ].join("/");
  const receipt = createKnowledgeContext({
    schemaVersion: 1,
    requestId: fixture.taskId,
    generatedAt: fixture.fixedNow,
    status: "no_hit",
    taskSummary: "验证品牌传播候选语义门禁。",
    capabilityId: "brand-communication",
    spaces: [
      { name: "老雷知识库", spaceId: "space-laolei" },
      { name: "老雷课件知识库", spaceId: "space-courseware" },
    ],
    queries: ["品牌传播"],
    sources: [],
    unreadCandidates: [],
    degradedReason: "",
  });
  const receiptBytes = Buffer.from(JSON.stringify(receipt, null, 2), "utf8");
  const receiptAbsolute = path.resolve(fixture.projectRoot, receiptPath);
  await fs.mkdir(path.dirname(receiptAbsolute), { recursive: true });
  await fs.writeFile(receiptAbsolute, receiptBytes);

  const readableArtifacts = [
    { ...POSITIONING_ARTIFACT },
    { ...VISUAL_ARTIFACT },
  ];
  const projectContext = {
    schemaVersion: 1,
    taskId: fixture.taskId,
    enterpriseId: fixture.enterpriseId,
    businessProjectId: fixture.businessProjectId,
    projectContextVersion: 1,
    readableArtifacts,
  };
  const receiptBinding = {
    receiptPath,
    receiptSha256: sha256(receiptBytes),
  };
  const request = {
    taskIdentity: { ...fixture.identity },
    skillId: "brand-communication",
    goal: "建立品牌信息母体与内容母题",
    requestedModuleIds: ["content-communication"],
    availableInputs: {},
    constraints: {},
    conversationFacts: [
      {
        id: "fact-core",
        claim: "今天的经营，今天看懂。",
        claimKey: "message-core",
        sourceRef: "conversation:brand-owner",
        confidence: "confirmed",
      },
      {
        id: "fact-support",
        claim: "先看清经营信号，再由老板作出决定。",
        claimKey: "message-support",
        sourceRef: "conversation:brand-owner",
        confidence: "confirmed",
      },
      {
        id: "fact-trust",
        claim: "产品能力与品牌起源均有当前项目证据。",
        claimKey: "message-trust",
        sourceRef: "conversation:brand-owner",
        confidence: "confirmed",
      },
      {
        id: "fact-pillar",
        claim: "长期解释每天值得关注的经营问题。",
        claimKey: "pillar-operating-clarity",
        sourceRef: "conversation:brand-owner",
        confidence: "confirmed",
      },
      {
        id: "fact-product",
        claim: "AI产品提供菜单毛利分析。",
        claimKey: "product-margin-analysis",
        sourceRef: "conversation:product-owner",
        confidence: "confirmed",
      },
      {
        id: "fact-product-copy",
        claim: "AI产品提供菜单毛利分析。",
        claimKey: "product-margin-analysis",
        sourceRef: "conversation:product-owner-copy",
        confidence: "confirmed",
      },
      {
        id: "fact-product-conflict",
        claim: "产品提供实时库存分析。",
        claimKey: "product-margin-analysis",
        sourceRef: "conversation:product-owner",
        confidence: "confirmed",
      },
      {
        id: "fact-origin",
        claim: "品牌起源是帮助餐饮老板更早看懂经营问题。",
        claimKey: "story-origin",
        sourceRef: "conversation:founder",
        confidence: "confirmed",
      },
      {
        id: "fact-founder",
        claim: "创始人当前公开身份是产品主理人。",
        claimKey: "founder-identity",
        sourceRef: "conversation:founder",
        confidence: "confirmed",
      },
      {
        id: "fact-award",
        claim: "企业曾获得区域创新奖。",
        claimKey: "company-award",
        sourceRef: "conversation:company-owner",
        confidence: "confirmed",
      },
      {
        id: "fact-no-claim-key",
        claim: "这条证据没有声明对应主张。",
        sourceRef: "conversation:unknown",
        confidence: "confirmed",
      },
    ],
    publicSources: [],
    professionalJudgments: [],
    criticalUnknowns: [],
  };
  let executeCount = 0;
  let reviewCount = 0;
  let clock = 0;
  const trustedOptions = {
    projectRoot: fixture.projectRoot,
    projectContext,
    receiptBinding,
    async executeModules() {
      executeCount += 1;
      return candidateFor(fixture, contentFactory());
    },
    async reviewCandidate() {
      reviewCount += 1;
      return {
        ruleReview: {
          reviewId: "rule-review-communication-001",
          reviewerId: RULE_REVIEWER_ID,
          reviewerRole: "rule-engine",
          passed: true,
          failedCriteria: [],
          hardVetoes: [],
        },
        professionalReview: {
          reviewId: "professional-review-communication-001",
          reviewerId: PROFESSIONAL_REVIEWER_ID,
          reviewerRole: "brand-professional-reviewer",
          passed: true,
          score: 92,
          observations: ["品牌信息单一、证据充分且组织边界清楚。"],
          correctionTargets: [],
        },
        affectedModuleIds: ["content-communication"],
        requiresBusinessDecision: false,
        blockedReason: "",
        remainingRisks: [],
        requestedBusinessInput: [],
      };
    },
    reviewerBindings: {
      ruleReviewerId: RULE_REVIEWER_ID,
      professionalReviewerId: PROFESSIONAL_REVIEWER_ID,
    },
    now() {
      const now = new Date(Date.parse(fixture.fixedNow) + clock * 1000);
      clock += 1;
      return now;
    },
  };
  const plan = buildBrandTaskPlan({
    ...fixture.identity,
    skillId: request.skillId,
    goal: request.goal,
    requestedModuleIds: request.requestedModuleIds,
    availableInputs: request.availableInputs,
    constraints: request.constraints,
    upstreamArtifacts: readableArtifacts,
  });
  const evidenceTrustedOptions = {
    projectRoot: fixture.projectRoot,
    projectContext,
    receiptBinding,
  };
  const evidenceBundle = await buildBrandEvidenceBundle({
    taskIdentity: { ...fixture.identity },
    skillId: request.skillId,
    conversationFacts: request.conversationFacts,
    publicSources: request.publicSources,
    professionalJudgments: request.professionalJudgments,
    requestedUpstreamArtifacts: readableArtifacts,
    criticalUnknowns: [],
  }, evidenceTrustedOptions);
  return {
    fixture,
    request,
    trustedOptions,
    plan,
    evidenceBundle,
    evidenceTrustedOptions,
    get executeCount() { return executeCount; },
    get reviewCount() { return reviewCount; },
  };
}

test("communication candidate schema is strict and defines exactly ten business fields", async () => {
  let schema;
  try {
    schema = JSON.parse(await fs.readFile(SCHEMA_PATH, "utf8"));
  } catch (error) {
    assert.fail(`brand communication candidate schema must exist: ${error.code}`);
  }
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  const content = schema.properties.content;
  assert.equal(content.additionalProperties, false);
  assert.deepEqual(content.required, EXACT_CONTENT_FIELDS);
  assert.deepEqual(Object.keys(content.properties), EXACT_CONTENT_FIELDS);
  assert.deepEqual(
    content.properties.contentPillars.items.allOf,
    [{ $ref: "#/$defs/confirmedClaimDigest" }],
  );
  assert.deepEqual(
    content.properties.proofLibrary.items.allOf,
    [{ $ref: "#/$defs/confirmedClaimDigest" }],
  );
  assert.deepEqual(
    schema.$defs.claim.allOf,
    [{ $ref: "#/$defs/confirmedClaimDigest" }],
  );
  assert.equal(
    schema.$defs.confirmedClaimDigest.then.properties.claimDigest.$ref,
    "#/$defs/sha256",
  );
});

test("runtime exposes a source-and-schema-bound communication policy context", async () => {
  assert.equal(
    typeof brandRuntimeModule.computeBrandCommunicationPolicyContext,
    "function",
  );
  const policy = await brandRuntimeModule
    .computeBrandCommunicationPolicyContext();
  assert.equal(policy.policyVersion, "brand-communication-policy-v1");
  assert.match(policy.validatorSourceSha256, /^[a-f0-9]{64}$/u);
  assert.match(policy.schemaSha256, /^[a-f0-9]{64}$/u);
  assert.equal(policy.policyContextHash, stableSha256({
    policyVersion: policy.policyVersion,
    validatorSourceSha256: policy.validatorSourceSha256,
    schemaSha256: policy.schemaSha256,
  }));
});

test("validator accepts a real evidence-bound exact-ten-field communication candidate", async (t) => {
  const { validateBrandCommunicationCandidate } = await loadValidator();
  const runtime = await makeCommunicationCase(t);
  const candidate = candidateFor(runtime.fixture);
  const validated = await validateBrandCommunicationCandidate(candidate, {
    plan: runtime.plan,
    evidenceBundle: runtime.evidenceBundle,
    evidenceTrustedOptions: runtime.evidenceTrustedOptions,
  });
  assert.equal(validated.candidateHash, candidate.candidateHash);
  assert.equal(Object.keys(validated.content).length, 10);
  assert.ok(Object.isFrozen(validated));
});

test("validator rejects missing, extra, wrong-boundary, and unsupported-confirmed content", async (t) => {
  const { validateBrandCommunicationCandidate } = await loadValidator();
  const runtime = await makeCommunicationCase(t);
  const trusted = {
    plan: runtime.plan,
    evidenceBundle: runtime.evidenceBundle,
    evidenceTrustedOptions: runtime.evidenceTrustedOptions,
  };
  const cases = [
    {
      label: "missing",
      mutate(content) { delete content.messageHierarchy; },
      pattern: /missing.*messageHierarchy|messageHierarchy.*missing/iu,
    },
    {
      label: "extra",
      mutate(content) { content.dailyChannelPlan = []; },
      pattern: /unknown field.*dailyChannelPlan/iu,
    },
    {
      label: "boundary",
      mutate(content) {
        content.channelAdaptationBoundary.brandOfficer =
          "AI品牌官负责小红书日更、私域运营和成交话术。";
      },
      pattern: /channel.*boundary|brandOfficer.*daily|brandOfficer.*日更/iu,
    },
    {
      label: "unsupported story",
      mutate(content) {
        content.brandStory.claims[0].status = "confirmed";
        content.brandStory.claims[0].evidenceIds = [];
      },
      pattern: /brandStory.*(?:confirmed.*evidence|evidence.*confirmed)/iu,
    },
    {
      label: "unsupported proof",
      mutate(content) {
        content.proofLibrary[0].status = "confirmed";
        content.proofLibrary[0].evidenceIds = ["missing-evidence"];
      },
      pattern: /proofLibrary.*evidenceId|unknown evidence/iu,
    },
  ];
  for (const item of cases) {
    const content = baseContent();
    item.mutate(content);
    await assert.rejects(
      validateBrandCommunicationCandidate(
        candidateFor(runtime.fixture, content),
        trusted,
      ),
      item.pattern,
      item.label,
    );
  }
});

test("confirmed communication claims require exact evidence claimKey binding and one evidence id cannot serve different claims", async (t) => {
  const { validateBrandCommunicationCandidate } = await loadValidator();
  const runtime = await makeCommunicationCase(t);
  const trusted = {
    plan: runtime.plan,
    evidenceBundle: runtime.evidenceBundle,
    evidenceTrustedOptions: runtime.evidenceTrustedOptions,
  };
  const cases = [
    {
      label: "missing candidate claimKey",
      mutate(content) {
        delete content.proofLibrary[0].claimKey;
      },
      pattern: /proofLibrary.*claimKey/iu,
    },
    {
      label: "unrelated award evidence",
      mutate(content) {
        content.proofLibrary[0].evidenceIds = ["fact-award"];
      },
      pattern: /claimKey.*(?:match|same|exact)|evidence.*claimKey/iu,
    },
    {
      label: "evidence without claimKey",
      mutate(content) {
        content.proofLibrary[0].evidenceIds = ["fact-no-claim-key"];
      },
      pattern: /claimKey.*(?:missing|match|exact)|evidence.*claimKey/iu,
    },
    {
      label: "cross-claim evidence reuse",
      mutate(content) {
        content.messageHierarchy.supportMessages[0].evidenceIds = [
          "fact-core",
        ];
      },
      pattern: /claimKey.*(?:match|reuse)|evidence.*(?:claimKey|reuse)/iu,
    },
  ];
  for (const item of cases) {
    const content = baseContent();
    item.mutate(content);
    await assert.rejects(
      validateBrandCommunicationCandidate(
        candidateFor(runtime.fixture, content),
        trusted,
      ),
      item.pattern,
      item.label,
    );
  }
});

test("confirmed claims bind actual normalized evidence semantics instead of trusting claimKey alone", async (t) => {
  const { validateBrandCommunicationCandidate } = await loadValidator();
  const runtime = await makeCommunicationCase(t);
  const trusted = {
    plan: runtime.plan,
    evidenceBundle: runtime.evidenceBundle,
    evidenceTrustedOptions: runtime.evidenceTrustedOptions,
  };

  const normalizedEquivalent = baseContent();
  normalizedEquivalent.proofLibrary[0].claim =
    "  ＡＩ产品提供菜单毛利分析。\u3000";
  normalizedEquivalent.proofLibrary[0].evidenceIds = [
    "fact-product",
    "fact-product-copy",
  ];
  await assert.doesNotReject(validateBrandCommunicationCandidate(
    candidateFor(runtime.fixture, normalizedEquivalent),
    trusted,
  ));

  const differentWordingWithEvidenceDigest = baseContent();
  differentWordingWithEvidenceDigest.proofLibrary[0].claim =
    "系统能够帮助查看菜单毛利。";
  differentWordingWithEvidenceDigest.proofLibrary[0].claimDigest =
    semanticClaimDigest("AI产品提供菜单毛利分析。");

  for (const [label, mutate, pattern] of [
    [
      "confirmed claim requires a supplied digest",
      (content) => {
        content.proofLibrary[0].claimDigest = null;
      },
      /claimDigest.*required|confirmed.*claimDigest/iu,
    ],
    [
      "different wording cannot borrow the correct evidence digest",
      (content) => {
        content.proofLibrary[0] =
          differentWordingWithEvidenceDigest.proofLibrary[0];
      },
      /claimDigest|candidate.*claim|claim text|three-way/iu,
    ],
    [
      "same claimKey but unrelated claim",
      (content) => {
        content.proofLibrary[0].claim = "企业获得区域创新奖。";
      },
      /claimDigest|semantic|normalized claim|claim text/iu,
    ],
    [
      "self-reported wrong digest",
      (content) => {
        content.proofLibrary[0].claim =
          "系统能够帮助查看菜单毛利。";
        content.proofLibrary[0].claimDigest = "d".repeat(64);
      },
      /claimDigest.*(?:candidate|evidence)|(?:candidate|evidence).*claimDigest/iu,
    ],
    [
      "all bound evidence must express the same normalized fact",
      (content) => {
        content.proofLibrary[0].evidenceIds = [
          "fact-product",
          "fact-product-conflict",
        ];
      },
      /claimDigest|evidence.*claim|same.*fact|three-way/iu,
    ],
  ]) {
    const content = baseContent();
    mutate(content);
    await assert.rejects(
      validateBrandCommunicationCandidate(
        candidateFor(runtime.fixture, content),
        trusted,
      ),
      pattern,
      label,
    );
  }
});

test("runtime blocks semantic failures before Task4 and a legal candidate reaches formal packager validation", async (t) => {
  for (const mutate of [
    (content) => { delete content.messageHierarchy; },
    (content) => { content.extraField = true; },
    (content) => {
      content.channelAdaptationBoundary.brandOfficer =
        "AI品牌官负责短视频日更、投流获客和成交脚本。";
    },
    (content) => {
      content.founderIpPosition.status = "confirmed";
      content.founderIpPosition.claims[0].status = "confirmed";
      content.founderIpPosition.claims[0].evidenceIds = [];
    },
  ]) {
    const invalid = await makeCommunicationCase(t, () => {
      const content = baseContent();
      mutate(content);
      return content;
    });
    const result = await runBrandSkillRuntime(
      invalid.request,
      invalid.trustedOptions,
    );
    assert.equal(result.outcome, "blocked");
    assert.equal(invalid.reviewCount, 0);
    assert.match(
      result.debugState.blockedReport.blockedReason,
      /communication semantic validation|semantic/iu,
    );
  }

  const valid = await makeCommunicationCase(t);
  const result = await runBrandSkillRuntime(valid.request, valid.trustedOptions);
  assert.equal(result.outcome, "candidate_ready");
  assert.equal(valid.reviewCount, 1);
  assert.doesNotThrow(() => (
    validateBrandDeliverablePackage(result.deliverable)
  ));
  const deliveredContent = JSON.parse(
    result.deliverable.systemPackage.output.contentJson,
  );
  assert.ok(Object.hasOwn(
    deliveredContent,
    "_brandDeliveryContextCommitment",
  ));
  const deliveredBusinessFields = Object.keys(deliveredContent)
    .filter((field) => !field.startsWith("_"))
    .sort();
  assert.deepEqual(
    deliveredBusinessFields,
    [...EXACT_CONTENT_FIELDS].sort(),
  );
});

test("communication runtime persists one immutable policy context and binds its hash through candidate, review, and deliverable", async (t) => {
  const runtime = await makeCommunicationCase(t);
  const result = await runBrandSkillRuntime(
    runtime.request,
    runtime.trustedOptions,
  );
  assert.equal(result.outcome, "candidate_ready");
  const policyPath = path.join(
    result.workspace.taskRoot,
    "communication-policy-context.json",
  );
  const policy = JSON.parse(await fs.readFile(policyPath, "utf8"));
  assert.equal(policy.skillId, "brand-communication");
  assert.equal(
    policy.policyVersion,
    "brand-communication-policy-v1",
  );
  assert.match(policy.validatorSourceSha256, /^[a-f0-9]{64}$/u);
  assert.match(policy.schemaSha256, /^[a-f0-9]{64}$/u);
  assert.equal(policy.policyContextHash, stableSha256({
    policyVersion: policy.policyVersion,
    validatorSourceSha256: policy.validatorSourceSha256,
    schemaSha256: policy.schemaSha256,
  }));

  const sidecar = JSON.parse(await fs.readFile(path.join(
    result.workspace.candidatesRoot,
    `${result.candidate.candidateId}.delivery-context.json`,
  ), "utf8"));
  assert.equal(sidecar.policyContextHash, policy.policyContextHash);

  const reviewRecord = JSON.parse(await fs.readFile(path.join(
    result.workspace.reviewsRoot,
    `${result.review.reviewHash}.json`,
  ), "utf8"));
  assert.equal(
    reviewRecord.policyContextHash,
    policy.policyContextHash,
  );
  assert.equal(
    result.deliverable.systemPackage.policyContextHash,
    policy.policyContextHash,
  );
});

test("missing or tampered communication policy on recovery blocks with policy_migration_required and never reuses a passing review", async (t) => {
  for (const mutation of ["delete", "change-hash", "tamper-bytes"]) {
    const runtime = await makeCommunicationCase(t);
    const first = await runBrandSkillRuntime(
      runtime.request,
      runtime.trustedOptions,
    );
    assert.equal(first.outcome, "candidate_ready");
    assert.equal(runtime.reviewCount, 1);
    const policyPath = path.join(
      first.workspace.taskRoot,
      "communication-policy-context.json",
    );
    if (mutation === "delete") {
      await fs.unlink(policyPath);
    } else if (mutation === "change-hash") {
      const policy = JSON.parse(await fs.readFile(policyPath, "utf8"));
      policy.policyContextHash = "c".repeat(64);
      await fs.writeFile(
        policyPath,
        `${JSON.stringify(policy, null, 2)}\n`,
        "utf8",
      );
    } else {
      await fs.writeFile(policyPath, "{\"broken\":true}\n", "utf8");
    }

    const recovered = await runBrandSkillRuntime(
      runtime.request,
      runtime.trustedOptions,
    );
    assert.equal(recovered.outcome, "blocked", mutation);
    assert.equal(
      recovered.diagnostic.code,
      "policy_migration_required",
      mutation,
    );
    assert.equal(recovered.review, null, mutation);
    assert.equal(runtime.reviewCount, 1, mutation);
    const auditFiles = (await fs.readdir(first.workspace.taskRoot))
      .filter((name) => (
        name.startsWith("communication-policy-migration-required.")
        && name.endsWith(".json")
      ));
    assert.equal(auditFiles.length, 1, mutation);
  }
});
