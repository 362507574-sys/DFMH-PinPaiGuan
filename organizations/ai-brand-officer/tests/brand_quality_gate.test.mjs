import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  evaluateBrandCandidate,
  POSTER_COMPARISON_CHECK_IDS,
  POSTER_DIMENSION_WEIGHTS,
  POSTER_HARD_VETOES,
  scorePosterCandidate,
  validateBrandCandidateReview,
} from '../scripts/brand_quality_gate.mjs';
import {
  stableSha256,
} from '../scripts/brand_contracts.mjs';
import {
  buildBrandEvidenceBundle,
} from '../scripts/brand_evidence_engine.mjs';
import {
  buildBrandTaskPlan,
} from '../scripts/brand_task_planner.mjs';
import {
  createKnowledgeContext,
} from '../../../scripts/feishu-commander/knowledge_context.mjs';

const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(
  TEST_ROOT,
  '..',
  'contracts',
  'brand-candidate-review.schema.json',
);
const RUBRIC_PATH = path.resolve(
  TEST_ROOT,
  '..',
  'skills',
  'brand-visual',
  'references',
  'poster-quality-rubric.md',
);
const IDENTITY = Object.freeze({
  enterpriseId: 'enterprise-001',
  businessProjectId: 'project-001',
  taskId: 'brand-task-001',
});
const RULE_REVIEWER_ID = 'reviewer-rule-001';
const PROFESSIONAL_REVIEWER_ID = 'reviewer-brand-001';
const DEFAULT_SPACES = Object.freeze([
  {
    name: '老雷知识库',
    spaceId: 'space-laolei',
  },
  {
    name: '老雷课件知识库',
    spaceId: 'space-courseware',
  },
]);

let fixture;

test.before(async () => {
  fixture = await createTrustedFixture();
});

test.after(async () => {
  await fs.rm(fixture.projectRoot, { recursive: true, force: true });
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function createTrustedFixture() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'brand-quality-gate-'),
  );
  const receiptPath = [
    'business-projects',
    IDENTITY.enterpriseId,
    IDENTITY.businessProjectId,
    'organizations',
    'ai-brand-officer',
    'tasks',
    IDENTITY.taskId,
    'evidence',
    'knowledge',
    'knowledge_context.json',
  ].join('/');
  const receipt = createKnowledgeContext({
    schemaVersion: 1,
    requestId: IDENTITY.taskId,
    generatedAt: '2026-07-29T08:00:00.000Z',
    status: 'no_hit',
    taskSummary: '验证品牌质量门禁可信复验',
    capabilityId: 'brand-positioning',
    spaces: structuredClone(DEFAULT_SPACES),
    queries: ['品牌定位', '质量门禁'],
    sources: [],
    unreadCandidates: [],
    degradedReason: '',
  });
  const receiptBytes = Buffer.from(JSON.stringify(receipt, null, 2), 'utf8');
  const receiptAbsolutePath = path.resolve(projectRoot, receiptPath);
  await fs.mkdir(path.dirname(receiptAbsolutePath), { recursive: true });
  await fs.writeFile(receiptAbsolutePath, receiptBytes);

  const projectContext = {
    schemaVersion: 1,
    taskId: IDENTITY.taskId,
    enterpriseId: IDENTITY.enterpriseId,
    businessProjectId: IDENTITY.businessProjectId,
    projectContextVersion: 1,
    readableArtifacts: [],
  };
  const evidenceTrustedOptions = {
    projectRoot,
    projectContext,
    receiptBinding: {
      receiptPath,
      receiptSha256: sha256(receiptBytes),
    },
  };
  const evidenceRequest = {
    taskIdentity: { ...IDENTITY },
    skillId: 'brand-positioning',
    conversationFacts: [{
      id: 'conversation-positioning',
      claim: '帝王确认首要心智是可复制的品牌增长方法。',
      sourceRef: 'conversation:turn-001',
      confidence: 'confirmed',
    }],
    publicSources: [],
    professionalJudgments: [{
      id: 'judgment-positioning',
      category: 'professional-judgment',
      claim: '候选必须收窄到一个核心心智。',
      sourceRef: 'brand-officer:professional-review',
      confidence: 'supported',
    }],
  };
  const evidenceBundle = await buildBrandEvidenceBundle(
    evidenceRequest,
    evidenceTrustedOptions,
  );
  const blockedEvidenceBundle = await buildBrandEvidenceBundle(
    {
      ...evidenceRequest,
      criticalUnknowns: [{
        id: 'critical-primary-audience',
        criticalField: 'primary-audience',
        description: '首要用户尚未确认。',
        sourceRef: 'unknown:business-owner',
      }],
    },
    evidenceTrustedOptions,
  );
  const plan = buildBrandTaskPlan({
    ...IDENTITY,
    skillId: 'brand-positioning',
    goal: '建立一个有证据支撑的差异化品牌定位',
    requestedModuleIds: ['differentiation-positioning'],
    availableInputs: {},
    constraints: {},
    upstreamArtifacts: [],
  });
  const candidate = makeCandidate();
  const reviewerBindings = {
    ruleReviewerId: RULE_REVIEWER_ID,
    professionalReviewerId: PROFESSIONAL_REVIEWER_ID,
  };
  return {
    projectRoot,
    plan,
    evidenceBundle,
    blockedEvidenceBundle,
    evidenceTrustedOptions,
    candidate,
    reviewerBindings,
  };
}

function makeCandidate(overrides = {}) {
  const withoutHash = {
    candidateId: 'candidate-001',
    ...IDENTITY,
    skillId: 'brand-positioning',
    content: {
      sections: [{
        sectionId: 'positioning-summary',
        content: '面向连锁经营者的可复制品牌增长方法。',
      }],
    },
    ...overrides,
  };
  return {
    ...withoutHash,
    candidateHash: stableSha256(withoutHash),
  };
}

function rehashCandidate(candidate) {
  const { candidateHash: ignored, ...withoutHash } = candidate;
  candidate.candidateHash = stableSha256(withoutHash);
  return candidate;
}

function makeRuleReview(overrides = {}) {
  return {
    reviewId: 'review-rule-001',
    reviewerId: RULE_REVIEWER_ID,
    reviewerRole: 'rule-engine',
    passed: true,
    failedCriteria: [],
    hardVetoes: [],
    ...overrides,
  };
}

function makeProfessionalReview(overrides = {}) {
  return {
    reviewId: 'review-professional-001',
    reviewerId: PROFESSIONAL_REVIEWER_ID,
    reviewerRole: 'brand-professional-reviewer',
    passed: true,
    score: 88,
    observations: ['候选清晰承接差异化定位。'],
    correctionTargets: [],
    ...overrides,
  };
}

function makeRequest(overrides = {}) {
  return {
    ruleReview: makeRuleReview(),
    professionalReview: makeProfessionalReview(),
    ...overrides,
  };
}

function makeTrustedOptions(overrides = {}) {
  return {
    plan: structuredClone(fixture.plan),
    evidenceBundle: structuredClone(fixture.evidenceBundle),
    evidenceTrustedOptions: structuredClone(fixture.evidenceTrustedOptions),
    candidate: structuredClone(fixture.candidate),
    reviewerBindings: structuredClone(fixture.reviewerBindings),
    ...overrides,
  };
}

function rehashEvidence(evidenceBundle) {
  const { evidenceHash: ignored, ...withoutHash } = evidenceBundle;
  evidenceBundle.evidenceHash = stableSha256(withoutHash);
  return evidenceBundle;
}

function rehashReview(review) {
  const { reviewHash: ignored, ...withoutHash } = review;
  review.reviewHash = stableSha256(withoutHash);
  return review;
}

function completeComparisonChecks(overrides = {}) {
  return POSTER_COMPARISON_CHECK_IDS.map((checkId) => ({
    checkId,
    passed: overrides[checkId]?.passed ?? true,
    observation:
      overrides[checkId]?.observation ?? `${checkId} 已按固定操作法通过。`,
  }));
}

function dimensionsForMillis(totalMillis) {
  let remaining = totalMillis;
  return Object.fromEntries(
    Object.entries(POSTER_DIMENSION_WEIGHTS).map(([dimensionId, maximum]) => {
      const millis = Math.min(maximum * 1000, remaining);
      remaining -= millis;
      return [dimensionId, millis / 1000];
    }),
  );
}

function makePosterInput(score = 90, overrides = {}) {
  return {
    candidateId: 'poster-001',
    hardVetoes: [],
    dimensions: dimensionsForMillis(Math.round(score * 1000)),
    comparisonChecks: completeComparisonChecks(),
    ...overrides,
  };
}

test('evaluate uses a strict two-layer async API and rejects trusted fields in request', async () => {
  const trustedOptions = makeTrustedOptions();
  const review = await evaluateBrandCandidate(makeRequest(), trustedOptions);
  assert.equal(review.verdict, 'candidate_ready');
  assert.deepEqual(review.taskIdentity, IDENTITY);

  for (const field of [
    'plan',
    'evidenceBundle',
    'evidenceTrustedOptions',
    'candidate',
    'reviewerBindings',
  ]) {
    await assert.rejects(
      async () => evaluateBrandCandidate({
        ...makeRequest(),
        [field]: trustedOptions[field],
      }, trustedOptions),
      /request.*unknown field/u,
    );
  }
  await assert.rejects(
    async () => evaluateBrandCandidate(makeRequest()),
    /trusted options.*required/u,
  );
  await assert.rejects(
    async () => evaluateBrandCandidate(makeRequest(), {
      ...trustedOptions,
      invented: true,
    }),
    /trusted options.*unknown field/u,
  );
});

test('real Task3 evidence is fully revalidated and minimal fake evidence is rejected', async () => {
  const trustedOptions = makeTrustedOptions({
    evidenceBundle: {
      taskIdentity: { ...IDENTITY },
      skillId: 'brand-positioning',
      blocked: false,
      evidenceHash: 'a'.repeat(64),
    },
  });
  await assert.rejects(
    async () => evaluateBrandCandidate(makeRequest(), trustedOptions),
    /brand evidence bundle.*missing|unknown field|schemaVersion/u,
  );
});

test('changing blocked to false and rehashing cannot bypass Task3 semantics', async () => {
  const forged = structuredClone(fixture.blockedEvidenceBundle);
  forged.blocked = false;
  rehashEvidence(forged);
  await assert.rejects(
    async () => evaluateBrandCandidate(
      makeRequest(),
      makeTrustedOptions({ evidenceBundle: forged }),
    ),
    /blocked must be recomputed/u,
  );
});

test('genuine blocked evidence is eliminated with an explicit failed criterion', async () => {
  const result = await evaluateBrandCandidate(
    makeRequest({
      professionalReview: makeProfessionalReview({ score: 100 }),
    }),
    makeTrustedOptions({
      evidenceBundle: structuredClone(fixture.blockedEvidenceBundle),
    }),
  );
  assert.equal(result.verdict, 'eliminated');
  assert.ok(result.failedCriteria.includes('evidence-blocked'));
});

test('plan, evidence, and candidate hashes are independently revalidated', async () => {
  const badPlan = structuredClone(fixture.plan);
  badPlan.planHash = '0'.repeat(64);
  await assert.rejects(
    async () => evaluateBrandCandidate(
      makeRequest(),
      makeTrustedOptions({ plan: badPlan }),
    ),
    /planHash.*contents/u,
  );

  const badEvidence = structuredClone(fixture.evidenceBundle);
  badEvidence.evidenceHash = '0'.repeat(64);
  await assert.rejects(
    async () => evaluateBrandCandidate(
      makeRequest(),
      makeTrustedOptions({ evidenceBundle: badEvidence }),
    ),
    /evidenceHash.*content/u,
  );

  const badCandidate = structuredClone(fixture.candidate);
  badCandidate.candidateHash = '0'.repeat(64);
  await assert.rejects(
    async () => evaluateBrandCandidate(
      makeRequest(),
      makeTrustedOptions({ candidate: badCandidate }),
    ),
    /candidateHash.*content/u,
  );
});

test('candidate is strict, non-empty, identity-bound safe JSON', async () => {
  const empty = makeCandidate({ content: {} });
  await assert.rejects(
    async () => evaluateBrandCandidate(
      makeRequest(),
      makeTrustedOptions({ candidate: empty }),
    ),
    /candidate content.*non-empty/u,
  );

  const extra = {
    ...structuredClone(fixture.candidate),
    invented: true,
  };
  rehashCandidate(extra);
  await assert.rejects(
    async () => evaluateBrandCandidate(
      makeRequest(),
      makeTrustedOptions({ candidate: extra }),
    ),
    /candidate.*unknown field/u,
  );

  const wrongIdentity = makeCandidate({ taskId: 'other-task' });
  await assert.rejects(
    async () => evaluateBrandCandidate(
      makeRequest(),
      makeTrustedOptions({ candidate: wrongIdentity }),
    ),
    /candidate taskId.*match/u,
  );
});

test('reviewer bindings and both review identities are mandatory and independent', async () => {
  const missingReviewer = makeRuleReview();
  delete missingReviewer.reviewerId;
  await assert.rejects(
    async () => evaluateBrandCandidate(
      makeRequest({ ruleReview: missingReviewer }),
      makeTrustedOptions(),
    ),
    /rule review.*missing.*reviewerId/u,
  );

  const missingReviewId = makeProfessionalReview();
  delete missingReviewId.reviewId;
  await assert.rejects(
    async () => evaluateBrandCandidate(
      makeRequest({ professionalReview: missingReviewId }),
      makeTrustedOptions(),
    ),
    /professional review.*missing.*reviewId/u,
  );

  await assert.rejects(
    async () => evaluateBrandCandidate(
      makeRequest({
        ruleReview: makeRuleReview({ reviewerId: 'other-reviewer' }),
      }),
      makeTrustedOptions(),
    ),
    /reviewerId.*binding/u,
  );

  await assert.rejects(
    async () => evaluateBrandCandidate(
      makeRequest({
        professionalReview: makeProfessionalReview({
          reviewId: 'review-rule-001',
        }),
      }),
      makeTrustedOptions(),
    ),
    /reviewId.*different/u,
  );

  await assert.rejects(
    async () => evaluateBrandCandidate(
      makeRequest(),
      makeTrustedOptions({
        reviewerBindings: {
          ruleReviewerId: RULE_REVIEWER_ID,
          professionalReviewerId: RULE_REVIEWER_ID,
        },
      }),
    ),
    /reviewer bindings.*different/u,
  );
});

test('role reviews are strict and a failed review cannot become candidate ready', async () => {
  await assert.rejects(
    async () => evaluateBrandCandidate(
      makeRequest({
        professionalReview: {
          ...makeProfessionalReview(),
          reviewerRole: 'rule-engine',
        },
      }),
      makeTrustedOptions(),
    ),
    /professional reviewer role|independent/u,
  );
  await assert.rejects(
    async () => evaluateBrandCandidate(
      makeRequest({
        ruleReview: {
          ...makeRuleReview(),
          unexpected: true,
        },
      }),
      makeTrustedOptions(),
    ),
    /rule review.*unknown field/u,
  );

  const failedRule = await evaluateBrandCandidate(
    makeRequest({
      ruleReview: makeRuleReview({
        passed: false,
        failedCriteria: ['定位证据不足'],
      }),
      professionalReview: makeProfessionalReview({ score: 92 }),
    }),
    makeTrustedOptions(),
  );
  assert.equal(failedRule.verdict, 'rework');

  const failedProfessional = await evaluateBrandCandidate(
    makeRequest({
      professionalReview: makeProfessionalReview({
        passed: false,
        score: 76,
        observations: ['心智表达仍然发散。'],
        correctionTargets: ['收窄心智词'],
      }),
    }),
    makeTrustedOptions(),
  );
  assert.equal(failedProfessional.verdict, 'rework');
});

test('professional review requires readable observations and failed reviews require corrections', async () => {
  await assert.rejects(
    async () => evaluateBrandCandidate(
      makeRequest({
        professionalReview: makeProfessionalReview({ observations: [] }),
      }),
      makeTrustedOptions(),
    ),
    /observations/u,
  );
  await assert.rejects(
    async () => evaluateBrandCandidate(
      makeRequest({
        professionalReview: makeProfessionalReview({
          passed: false,
          correctionTargets: [],
        }),
      }),
      makeTrustedOptions(),
    ),
    /correctionTargets/u,
  );
});

test('rule review pass state must agree with failed criteria and hard vetoes', async () => {
  await assert.rejects(
    async () => evaluateBrandCandidate(
      makeRequest({
        ruleReview: makeRuleReview({
          passed: true,
          hardVetoes: ['product-fidelity-failure'],
        }),
      }),
      makeTrustedOptions(),
    ),
    /passed.*hardVetoes|contradict/u,
  );

  const valid = await evaluateBrandCandidate(
    makeRequest({
      ruleReview: makeRuleReview({
        passed: false,
        hardVetoes: ['product-fidelity-failure'],
      }),
      professionalReview: makeProfessionalReview({ score: 100 }),
    }),
    makeTrustedOptions(),
  );
  const forged = structuredClone(valid);
  forged.reviewTrace[0].passed = true;
  rehashReview(forged);
  await assert.rejects(
    async () => validateBrandCandidateReview(
      forged,
      makeTrustedOptions(),
    ),
    /passed.*hardVetoes|contradict/u,
  );

  await assert.rejects(
    async () => evaluateBrandCandidate(
      makeRequest({
        ruleReview: makeRuleReview({
          passed: false,
          failedCriteria: [],
          hardVetoes: [],
        }),
      }),
      makeTrustedOptions(),
    ),
    /failed rule review requires/u,
  );
});

test('hard veto overrides score and hard veto order is canonical', async () => {
  const reversed = [
    'forbidden-style-direction',
    'product-fidelity-failure',
  ];
  const first = await evaluateBrandCandidate(
    makeRequest({
      ruleReview: makeRuleReview({
        passed: false,
        hardVetoes: reversed,
      }),
      professionalReview: makeProfessionalReview({ score: 100 }),
    }),
    makeTrustedOptions(),
  );
  const second = await evaluateBrandCandidate(
    makeRequest({
      ruleReview: makeRuleReview({
        passed: false,
        hardVetoes: [...reversed].reverse(),
      }),
      professionalReview: makeProfessionalReview({ score: 100 }),
    }),
    makeTrustedOptions(),
  );
  assert.equal(first.verdict, 'eliminated');
  assert.deepEqual(first.hardVetoes, [
    'product-fidelity-failure',
    'forbidden-style-direction',
  ]);
  assert.equal(first.reviewHash, second.reviewHash);
});

test('generic score thresholds use exact integer thousandths', async () => {
  for (const [score, verdict] of [
    [69, 'eliminated'],
    [70, 'rework'],
    [79.999, 'rework'],
    [80, 'candidate_ready'],
    [89.999, 'candidate_ready'],
    [90, 'preferred'],
    [100, 'preferred'],
  ]) {
    const result = await evaluateBrandCandidate(
      makeRequest({
        professionalReview: makeProfessionalReview({ score }),
      }),
      makeTrustedOptions(),
    );
    assert.equal(result.score, score, `score ${score}`);
    assert.equal(result.verdict, verdict, `score ${score}`);
  }
  for (const score of [
    79.9999999999996,
    89.9999999999996,
  ]) {
    await assert.rejects(
      async () => evaluateBrandCandidate(
        makeRequest({
          professionalReview: makeProfessionalReview({ score }),
        }),
        makeTrustedOptions(),
      ),
      /at most 3 decimal places/u,
    );
  }
});

test('output binds trusted identity and hashes and is deeply frozen', async () => {
  const request = makeRequest();
  const trustedOptions = makeTrustedOptions();
  const requestSnapshot = structuredClone(request);
  const trustedSnapshot = structuredClone(trustedOptions);
  const output = await evaluateBrandCandidate(request, trustedOptions);
  assert.deepEqual(request, requestSnapshot);
  assert.deepEqual(trustedOptions, trustedSnapshot);
  assert.deepEqual(Object.keys(output).sort(), [
    'candidateHash',
    'candidateId',
    'correctionTargets',
    'evidenceHash',
    'failedCriteria',
    'hardVetoes',
    'planHash',
    'reviewHash',
    'reviewTrace',
    'score',
    'skillId',
    'taskIdentity',
    'verdict',
  ].sort());
  assert.equal(output.planHash, fixture.plan.planHash);
  assert.equal(output.evidenceHash, fixture.evidenceBundle.evidenceHash);
  assert.equal(output.candidateHash, fixture.candidate.candidateHash);
  assert.deepEqual(
    output.reviewTrace.map((entry) => entry.reviewerRole),
    ['rule-engine', 'brand-professional-reviewer'],
  );
  assert.equal(output.reviewTrace[0].reviewerId, RULE_REVIEWER_ID);
  assert.equal(
    output.reviewTrace[1].reviewerId,
    PROFESSIONAL_REVIEWER_ID,
  );
  assert.equal(Object.isFrozen(output), true);
  assert.equal(Object.isFrozen(output.reviewTrace[0]), true);
  assert.throws(() => output.reviewTrace.push({}), TypeError);
});

test('validator replays trusted inputs and rejects a freshly hashed forged preferred review', async () => {
  const valid = await evaluateBrandCandidate(
    makeRequest(),
    makeTrustedOptions(),
  );
  assert.equal(
    await validateBrandCandidateReview(valid, makeTrustedOptions()),
    true,
  );

  const forged = structuredClone(valid);
  forged.verdict = 'preferred';
  forged.score = 100;
  forged.reviewTrace[1].score = 100;
  forged.reviewTrace[1].reviewerId = 'forged-reviewer';
  rehashReview(forged);
  await assert.rejects(
    async () => validateBrandCandidateReview(
      forged,
      makeTrustedOptions(),
    ),
    /trusted binding|trusted review|canonical review|review semantics|does not match/u,
  );
});

test('validator rejects wrong trusted binding even when review hash is self-consistent', async () => {
  const valid = await evaluateBrandCandidate(
    makeRequest(),
    makeTrustedOptions(),
  );
  const wrongCandidate = makeCandidate({
    candidateId: 'candidate-002',
    content: { summary: '另一份候选' },
  });
  await assert.rejects(
    async () => validateBrandCandidateReview(
      valid,
      makeTrustedOptions({ candidate: wrongCandidate }),
    ),
    /candidateId|candidateHash|trusted review|does not match/u,
  );

  const reorderedTrace = structuredClone(valid);
  reorderedTrace.reviewTrace.reverse();
  rehashReview(reorderedTrace);
  await assert.rejects(
    async () => validateBrandCandidateReview(
      reorderedTrace,
      makeTrustedOptions(),
    ),
    /reviewTrace.*canonical|role order/u,
  );
});

test('snapshot rejects a huge sparse array before enumeration', async () => {
  const huge = [];
  huge.length = 500_000;
  const candidate = structuredClone(fixture.candidate);
  candidate.content = { huge };
  candidate.candidateHash = 'a'.repeat(64);
  await assert.rejects(
    async () => evaluateBrandCandidate(
      makeRequest(),
      makeTrustedOptions({ candidate }),
    ),
    /array.*limit|maximum.*items|resource limit/u,
  );
});

test('snapshot rejects Proxy and accessor candidate content without invoking traps', async () => {
  let traps = 0;
  const proxyContent = new Proxy({ summary: '候选' }, {
    getOwnPropertyDescriptor() {
      traps += 1;
      throw new Error('trap must not run');
    },
    getPrototypeOf() {
      traps += 1;
      throw new Error('trap must not run');
    },
    ownKeys() {
      traps += 1;
      throw new Error('trap must not run');
    },
  });
  const proxyCandidate = structuredClone(fixture.candidate);
  proxyCandidate.content = proxyContent;
  proxyCandidate.candidateHash = 'a'.repeat(64);
  await assert.rejects(
    async () => evaluateBrandCandidate(
      makeRequest(),
      makeTrustedOptions({ candidate: proxyCandidate }),
    ),
    /Proxy.*unsupported/u,
  );
  assert.equal(traps, 0);

  let invoked = 0;
  const accessorContent = {};
  Object.defineProperty(accessorContent, 'summary', {
    enumerable: true,
    get() {
      invoked += 1;
      return '候选';
    },
  });
  const accessorCandidate = structuredClone(fixture.candidate);
  accessorCandidate.content = accessorContent;
  accessorCandidate.candidateHash = 'a'.repeat(64);
  await assert.rejects(
    async () => evaluateBrandCandidate(
      makeRequest(),
      makeTrustedOptions({ candidate: accessorCandidate }),
    ),
    /accessor/u,
  );
  assert.equal(invoked, 0);
});

test('poster hard veto eliminates 100 points and fixed codes remain complete', () => {
  assert.deepEqual(POSTER_HARD_VETOES, [
    'product-fidelity-failure',
    'person-fidelity-failure',
    'logo-fidelity-failure',
    'precise-text-error',
    'core-message-missed',
    'positioning-conflict',
    'similarity-or-copyright-risk',
    'unreadable-critical-information',
    'ai-artifact-or-cheap-template',
    'forbidden-style-direction',
  ]);
  const result = scorePosterCandidate(makePosterInput(100, {
    hardVetoes: ['product-fidelity-failure'],
  }));
  assert.equal(result.score, 100);
  assert.equal(result.verdict, 'eliminated');
});

test('poster thresholds use exact thousandths and reject extra decimals', () => {
  for (const [score, verdict] of [
    [69, 'eliminated'],
    [70, 'rework'],
    [79.999, 'rework'],
    [80, 'candidate_ready'],
    [89.999, 'candidate_ready'],
    [90, 'preferred'],
    [100, 'preferred'],
  ]) {
    const result = scorePosterCandidate(makePosterInput(score));
    assert.equal(result.score, score);
    assert.equal(result.verdict, verdict);
  }
  assert.throws(
    () => scorePosterCandidate(makePosterInput(80, {
      dimensions: {
        ...dimensionsForMillis(80_000),
        visualAesthetics: 24.9999,
      },
    })),
    /at most 3 decimal places/u,
  );
});

test('poster dimensions and comparison checks remain strict and failures downgrade', () => {
  assert.deepEqual(POSTER_DIMENSION_WEIGHTS, {
    brandStrategy: 20,
    visualAesthetics: 25,
    informationEfficiency: 20,
    brandConsistency: 15,
    craftQuality: 10,
    channelFitness: 10,
  });
  assert.throws(
    () => scorePosterCandidate(makePosterInput(90, {
      comparisonChecks: completeComparisonChecks().slice(0, 6),
    })),
    /seven comparison checks/u,
  );
  assert.throws(
    () => scorePosterCandidate(makePosterInput(90, {
      hardVetoes: ['invented-veto'],
    })),
    /unknown hard veto/u,
  );
  const failed = scorePosterCandidate(makePosterInput(96, {
    comparisonChecks: completeComparisonChecks({
      thumbnail: {
        passed: false,
        observation: '缩略图下品牌名无法辨认。',
      },
    }),
  }));
  assert.equal(failed.verdict, 'rework');
  assert.ok(failed.failedCriteria.includes('thumbnail'));
});

test('poster semantic reordering produces one canonical output and hash', () => {
  const first = scorePosterCandidate(makePosterInput(95, {
    hardVetoes: [
      'forbidden-style-direction',
      'product-fidelity-failure',
    ],
    comparisonChecks: [...completeComparisonChecks()].reverse(),
  }));
  const second = scorePosterCandidate(makePosterInput(95, {
    hardVetoes: [
      'product-fidelity-failure',
      'forbidden-style-direction',
    ],
    comparisonChecks: completeComparisonChecks(),
  }));
  assert.deepEqual(first.hardVetoes, second.hardVetoes);
  assert.deepEqual(first.reviewTrace, second.reviewTrace);
  assert.equal(first.reviewHash, second.reviewHash);
});

test('candidate review schema locks trusted binding and full review identities', async () => {
  const schema = JSON.parse(await fs.readFile(SCHEMA_PATH, 'utf8'));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required.sort(), [
    'candidateHash',
    'candidateId',
    'correctionTargets',
    'evidenceHash',
    'failedCriteria',
    'hardVetoes',
    'planHash',
    'reviewHash',
    'reviewTrace',
    'score',
    'skillId',
    'taskIdentity',
    'verdict',
  ].sort());
  for (const constraint of [
    'independent-reviewers',
    'trusted-context-revalidation',
    'full-evidence-validation',
    'candidate-hash-correspondence',
    'content-hash-not-signature',
    'canonical-array-order',
  ]) {
    assert.ok(schema['x-runtimeConstraints'].includes(constraint));
  }
  assert.equal(schema.properties.reviewTrace.minItems, 2);
  assert.equal(schema.properties.reviewTrace.maxItems, 2);
  assert.equal(schema.properties.reviewTrace.items.oneOf.length, 2);
  for (const branch of schema.properties.reviewTrace.items.oneOf) {
    const definitionName = branch.$ref.split('/').at(-1);
    const definition = schema.$defs[definitionName];
    assert.ok(definition.required.includes('reviewId'));
    assert.ok(definition.required.includes('reviewerId'));
  }
  const ruleDefinition = schema.$defs.ruleReviewTrace;
  assert.equal(ruleDefinition.allOf.length, 2);
  assert.equal(
    ruleDefinition.allOf[0].then.properties.failedCriteria.maxItems,
    0,
  );
  assert.equal(
    ruleDefinition.allOf[0].then.properties.hardVetoes.maxItems,
    0,
  );
  assert.equal(ruleDefinition.allOf[1].then.anyOf.length, 2);
});

test('poster rubric states that hashes are fingerprints, not authenticity proofs', async () => {
  const rubric = await fs.readFile(RUBRIC_PATH, 'utf8');
  for (const phrase of [
    '确定性内容指纹',
    '不是签名',
    '不能证明审核者真实性',
    '可信运行时注入',
    '完整证据复验',
    '评分不能覆盖硬否决',
    '最多三轮',
  ]) {
    assert.match(rubric, new RegExp(phrase, 'u'), `missing rubric phrase: ${phrase}`);
  }
  for (const veto of POSTER_HARD_VETOES) {
    assert.match(rubric, new RegExp(veto, 'u'), `missing veto: ${veto}`);
  }
});
