import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  advanceBrandDebugState,
  createBrandDebugState,
  validateBrandDebugState,
} from '../scripts/brand_debug_controller.mjs';
import { stableSha256 } from '../scripts/brand_contracts.mjs';
import { buildBrandEvidenceBundle } from '../scripts/brand_evidence_engine.mjs';
import { evaluateBrandCandidate } from '../scripts/brand_quality_gate.mjs';
import { buildBrandTaskPlan } from '../scripts/brand_task_planner.mjs';
import {
  createKnowledgeContext,
} from '../../../scripts/feishu-commander/knowledge_context.mjs';

const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_FILE = path.resolve(TEST_ROOT, '..', 'contracts', 'brand-debug-state.schema.json');
const TASK_IDENTITY = Object.freeze({
  enterpriseId: 'enterprise-001',
  businessProjectId: 'project-001',
  taskId: 'brand-task-001',
});
const RULE_REVIEWER_ID = 'reviewer-rule-001';
const PROFESSIONAL_REVIEWER_ID = 'reviewer-brand-001';
const ROOT_FIELDS = Object.freeze([
  'schemaVersion',
  'taskIdentity',
  'skillId',
  'planHash',
  'evidenceHash',
  'createdAt',
  'revision',
  'previousStateHash',
  'status',
  'rootCauseAttempts',
  'transientAttempts',
  'activeCorrection',
  'attemptedCorrections',
  'timeline',
  'blockedReport',
  'stateHash',
]);

let fixture;

test.before(async () => {
  fixture = await createTrustedFixture();
  fixture.reviewRecords = [];
  for (let index = 0; index < 4; index += 1) {
    const candidate = makeCandidate(index);
    const reviewTrustedOptions = makeReviewTrustedOptions({ candidate });
    const failed = await evaluateBrandCandidate(
      makeReviewRequest({
        ruleReview: makeRuleReview({
          reviewId: `review-rule-failed-${index}`,
          passed: false,
          failedCriteria: ['positioning-evidence'],
        }),
        professionalReview: makeProfessionalReview({
          reviewId: `review-professional-failed-${index}`,
        }),
      }),
      reviewTrustedOptions,
    );
    fixture.reviewRecords.push({
      review: failed,
      reviewTrustedOptions,
    });
  }
  const passedCandidate = makeCandidate(9);
  const passedOptions = makeReviewTrustedOptions({ candidate: passedCandidate });
  fixture.passedRecord = {
    review: await evaluateBrandCandidate(
      makeReviewRequest({
        ruleReview: makeRuleReview({ reviewId: 'review-rule-passed' }),
        professionalReview: makeProfessionalReview({
          reviewId: 'review-professional-passed',
        }),
      }),
      passedOptions,
    ),
    reviewTrustedOptions: passedOptions,
  };
  const reusedIdWithoutHash = {
    ...fixture.candidateWithoutHash,
    candidateId: 'candidate-0',
    content: {
      sections: [{
        sectionId: 'positioning-summary',
        content: '复用旧候选 ID 但更换内容的攻击版本。',
      }],
    },
  };
  const reusedIdCandidate = {
    ...reusedIdWithoutHash,
    candidateHash: stableSha256(reusedIdWithoutHash),
  };
  const reusedIdOptions = makeReviewTrustedOptions({ candidate: reusedIdCandidate });
  fixture.reusedIdRecord = {
    review: await evaluateBrandCandidate(
      makeReviewRequest({
        ruleReview: makeRuleReview({
          reviewId: 'review-rule-reused-id',
          passed: false,
          failedCriteria: ['positioning-evidence'],
        }),
        professionalReview: makeProfessionalReview({
          reviewId: 'review-professional-reused-id',
        }),
      }),
      reusedIdOptions,
    ),
    reviewTrustedOptions: reusedIdOptions,
  };
});

test.after(async () => {
  await fs.rm(fixture.projectRoot, { recursive: true, force: true });
});

function iso(second) {
  return `2026-07-29T10:00:${String(second).padStart(2, '0')}.000Z`;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function taskKey(taskIdentity) {
  return [
    taskIdentity.enterpriseId,
    taskIdentity.businessProjectId,
    taskIdentity.taskId,
  ].join('/');
}

function makeAuthority({
  records = [
    ...fixture.reviewRecords,
    fixture.passedRecord,
    fixture.reusedIdRecord,
  ],
  diagnostics = {},
} = {}) {
  const states = new Map();
  let crashNextCommit = false;
  const reviews = new Map(
    records.map((record) => {
      const reviewHash = record.review.reviewHash;
      const diagnostic = diagnostics[reviewHash] ?? makeDiagnostic();
      return [
        reviewHash,
        structuredClone({ ...record, diagnostic }),
      ];
    }),
  );
  const runtime = Object.freeze({
    async resolveReview(reviewHash) {
      const record = reviews.get(reviewHash);
      if (record === undefined) throw new Error(`trusted review not found: ${reviewHash}`);
      return structuredClone(record);
    },
    async initializeDebugState({ taskIdentity, state }) {
      const key = taskKey(taskIdentity);
      if (states.has(key)) return false;
      states.set(key, structuredClone(state));
      return true;
    },
    async readDebugState(taskIdentity) {
      const state = states.get(taskKey(taskIdentity));
      return state === undefined ? null : structuredClone(state);
    },
    async commitDebugState({
      taskIdentity,
      expectedRevision,
      expectedStateHash,
      nextState,
    }) {
      const key = taskKey(taskIdentity);
      const current = states.get(key);
      if (
        current === undefined
        || current.revision !== expectedRevision
        || current.stateHash !== expectedStateHash
      ) return false;
      if (crashNextCommit) {
        crashNextCommit = false;
        throw new Error('simulated atomic commit crash');
      }
      states.set(key, structuredClone(nextState));
      return true;
    },
  });
  return Object.freeze({
    runtime,
    readStored(taskIdentity = TASK_IDENTITY) {
      return structuredClone(states.get(taskKey(taskIdentity)));
    },
    setStored(state, taskIdentity = TASK_IDENTITY) {
      states.set(taskKey(taskIdentity), structuredClone(state));
    },
    crashCommitOnce() {
      crashNextCommit = true;
    },
    deleteReview(reviewHash) {
      reviews.delete(reviewHash);
    },
  });
}

async function create(authority, overrides = {}) {
  return createBrandDebugState({
    taskIdentity: TASK_IDENTITY,
    skillId: fixture.plan.skillId,
    planHash: fixture.plan.planHash,
    evidenceHash: fixture.evidenceBundle.evidenceHash,
    now: iso(0),
    ...overrides,
  }, authority.runtime);
}

async function advance(authority, current, type, second, event = {}) {
  return advanceBrandDebugState({
    current,
    event: { type, ...event },
    now: iso(second),
  }, authority.runtime);
}

async function reachExecuting(authority, state, startSecond = 1) {
  let current = await advance(authority, state, 'start-planning', startSecond);
  current = await advance(authority, current, 'plan-ready', startSecond + 1);
  return advance(authority, current, 'evidence-ready', startSecond + 2);
}

async function reachReviewing(authority, state, startSecond = 1) {
  let current = await reachExecuting(authority, state, startSecond);
  current = await advance(authority, current, 'execution-ready', startSecond + 3);
  return advance(authority, current, 'review-started', startSecond + 4);
}

function failureEvent(reviewHash, overrides = {}) {
  return {
    reviewHash,
    ...overrides,
  };
}

function makeDiagnostic(overrides = {}) {
  return {
    affectedModuleIds: ['audience-positioning'],
    correction: '补充目标用户证据并重做受影响模块',
    requiresBusinessDecision: false,
    blockedReason: '',
    remainingRisks: [],
    requestedBusinessInput: [],
    ...overrides,
  };
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

function makeReviewRequest(overrides = {}) {
  return {
    ruleReview: makeRuleReview(),
    professionalReview: makeProfessionalReview(),
    ...overrides,
  };
}

function makeCandidate(index) {
  const withoutHash = {
    ...fixture.candidateWithoutHash,
    candidateId: `candidate-${index}`,
    content: {
      sections: [{
        sectionId: 'positioning-summary',
        content: `面向连锁经营者的可复制品牌增长方法，第 ${index} 版。`,
      }],
    },
  };
  return { ...withoutHash, candidateHash: stableSha256(withoutHash) };
}

function makeReviewTrustedOptions(overrides = {}) {
  return {
    plan: structuredClone(fixture.plan),
    evidenceBundle: structuredClone(fixture.evidenceBundle),
    evidenceTrustedOptions: structuredClone(fixture.evidenceTrustedOptions),
    candidate: structuredClone(fixture.candidate),
    reviewerBindings: structuredClone(fixture.reviewerBindings),
    ...overrides,
  };
}

function rehashTimelineAndState(state) {
  let previousEventHash = null;
  for (const event of state.timeline) {
    event.previousEventHash = previousEventHash;
    const { eventHash: ignored, ...withoutEventHash } = event;
    event.eventHash = stableSha256(withoutEventHash);
    previousEventHash = event.eventHash;
  }
  const { stateHash: ignored, ...withoutHash } = state;
  state.stateHash = stableSha256(withoutHash);
  return state;
}

function assertDeepFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

async function createTrustedFixture() {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'brand-debug-controller-'));
  const receiptPath = [
    'business-projects',
    TASK_IDENTITY.enterpriseId,
    TASK_IDENTITY.businessProjectId,
    'organizations',
    'ai-brand-officer',
    'tasks',
    TASK_IDENTITY.taskId,
    'evidence',
    'knowledge',
    'knowledge_context.json',
  ].join('/');
  const receipt = createKnowledgeContext({
    schemaVersion: 1,
    requestId: TASK_IDENTITY.taskId,
    generatedAt: '2026-07-29T08:00:00.000Z',
    status: 'no_hit',
    taskSummary: '验证调试控制器对 Task4 审核的可信恢复。',
    capabilityId: 'brand-positioning',
    spaces: [
      { name: '老雷知识库', spaceId: 'space-laolei' },
      { name: '老雷课件知识库', spaceId: 'space-courseware' },
    ],
    queries: ['品牌定位', '调试审核'],
    sources: [],
    unreadCandidates: [],
    degradedReason: '',
  });
  const receiptBytes = Buffer.from(JSON.stringify(receipt, null, 2), 'utf8');
  const receiptAbsolutePath = path.resolve(projectRoot, receiptPath);
  await fs.mkdir(path.dirname(receiptAbsolutePath), { recursive: true });
  await fs.writeFile(receiptAbsolutePath, receiptBytes);

  const evidenceTrustedOptions = {
    projectRoot,
    projectContext: {
      schemaVersion: 1,
      taskId: TASK_IDENTITY.taskId,
      enterpriseId: TASK_IDENTITY.enterpriseId,
      businessProjectId: TASK_IDENTITY.businessProjectId,
      projectContextVersion: 1,
      readableArtifacts: [],
    },
    receiptBinding: { receiptPath, receiptSha256: sha256(receiptBytes) },
  };
  const evidenceBundle = await buildBrandEvidenceBundle({
    taskIdentity: { ...TASK_IDENTITY },
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
  }, evidenceTrustedOptions);
  const plan = buildBrandTaskPlan({
    ...TASK_IDENTITY,
    skillId: 'brand-positioning',
    goal: '建立一个有证据支撑的差异化品牌定位',
    requestedModuleIds: ['audience-positioning', 'category-positioning'],
    availableInputs: {},
    constraints: {},
    upstreamArtifacts: [],
  });
  const candidateWithoutHash = {
    candidateId: 'candidate-base',
    ...TASK_IDENTITY,
    skillId: 'brand-positioning',
    content: {
      sections: [{
        sectionId: 'positioning-summary',
        content: '面向连锁经营者的可复制品牌增长方法。',
      }],
    },
  };
  return {
    projectRoot,
    plan,
    evidenceBundle,
    evidenceTrustedOptions,
    candidateWithoutHash,
    candidate: {
      ...candidateWithoutHash,
      candidateHash: stableSha256(candidateWithoutHash),
    },
    reviewerBindings: {
      ruleReviewerId: RULE_REVIEWER_ID,
      professionalReviewerId: PROFESSIONAL_REVIEWER_ID,
    },
  };
}

test('creates immutable revision zero and atomically initializes the trusted full state', async () => {
  const authority = makeAuthority();
  const state = await create(authority);
  assert.deepEqual(Object.keys(state), ROOT_FIELDS);
  assert.equal(state.createdAt, iso(0));
  assert.equal(state.revision, 0);
  assert.equal(state.previousStateHash, null);
  assert.deepEqual(authority.readStored(), state);
  assertDeepFrozen(state);
  assert.equal(await validateBrandDebugState(state, authority.runtime), true);
});

test('duplicate full-state initialization is rejected by the trusted authority', async () => {
  const authority = makeAuthority();
  await create(authority);
  await assert.rejects(() => create(authority), /already exists|initialize/i);
});

test('review-failed event cannot self-report diagnostic modules, correction, or root cause', async () => {
  const authority = makeAuthority();
  const state = await create(authority);
  await assert.rejects(
    () => advance(authority, state, 'start-planning', 1, {
      reviewHash: fixture.reviewRecords[0].review.reviewHash,
      review: fixture.reviewRecords[0].review,
    }),
    /unknown field/i,
  );
  const reviewing = await reachReviewing(authority, state);
  await assert.rejects(
    () => advance(authority, reviewing, 'review-failed', 6, failureEvent(
      fixture.reviewRecords[0].review.reviewHash,
      {
        affectedModuleIds: ['category-positioning'],
        correction: '调用方伪造修正措施',
        rootCauseCode: 'rotated-cause',
      },
    )),
    /unknown field.*affectedModuleIds/i,
  );
});

test('real Task4 passed review is resolved only by hash and reaches candidate_ready', async () => {
  const authority = makeAuthority();
  const reviewing = await reachReviewing(authority, await create(authority));
  const review = fixture.passedRecord.review;
  const next = await advance(authority, reviewing, 'review-passed', 6, {
    reviewHash: review.reviewHash,
  });
  assert.equal(next.status, 'candidate_ready');
  assert.equal(next.timeline.at(-1).reviewHash, review.reviewHash);
  assert.equal(next.timeline.at(-1).candidateHash, review.candidateHash);
  assert.equal(next.timeline.at(-1).reviewVerdict, review.verdict);
  assert.equal(next.revision, reviewing.revision + 1);
  assert.equal(next.previousStateHash, reviewing.stateHash);
  assert.equal(await validateBrandDebugState(next, authority.runtime), true);
});

test('missing resolver record fails before the trusted stored state changes', async () => {
  const authority = makeAuthority();
  const reviewing = await reachReviewing(authority, await create(authority));
  const stored = authority.readStored();
  const hash = fixture.reviewRecords[0].review.reviewHash;
  authority.deleteReview(hash);
  await assert.rejects(
    () => advance(authority, reviewing, 'review-failed', 6, failureEvent(hash)),
    /trusted review not found/i,
  );
  assert.deepEqual(authority.readStored(), stored);
});

test('initial failed review only plans an active correction and records no applied attempt', async () => {
  const authority = makeAuthority();
  const reviewing = await reachReviewing(authority, await create(authority));
  const review = fixture.reviewRecords[0].review;
  const next = await advance(
    authority,
    reviewing,
    'review-failed',
    6,
    failureEvent(review.reviewHash),
  );
  assert.equal(next.status, 'reworking');
  assert.equal(next.attemptedCorrections.length, 0);
  assert.deepEqual(next.rootCauseAttempts, {});
  assert.equal(next.activeCorrection.inputCandidateHash, review.candidateHash);
  assert.match(next.activeCorrection.roundId, /^round-[a-f0-9]{12}-1$/u);
  assert.equal(next.activeCorrection.rootCauseCode, `cause-${next.activeCorrection.rootCauseFingerprint.slice(0, 16)}`);
  assert.equal(next.activeCorrection.treatmentId, 'local-correction');
  assert.match(next.activeCorrection.correction, /^local-correction: /u);
  assert.equal(
    next.activeCorrection.actionHash,
    stableSha256(next.activeCorrection.correction),
  );
});

test('rework-ready requires changed output and produces one unvalidated applied record', async () => {
  const authority = makeAuthority();
  let state = await reachReviewing(authority, await create(authority));
  state = await advance(authority, state, 'review-failed', 6, failureEvent(
    fixture.reviewRecords[0].review.reviewHash,
  ));
  await assert.rejects(
    () => advance(authority, state, 'rework-ready', 7, {
      roundId: state.activeCorrection.roundId,
      outputCandidateHash: state.activeCorrection.inputCandidateHash,
      executionEvidence: sha256('unchanged'),
    }),
    /must differ|unchanged/i,
  );
  const next = await advance(authority, state, 'rework-ready', 7, {
    roundId: state.activeCorrection.roundId,
    outputCandidateHash: fixture.reviewRecords[1].review.candidateHash,
    executionEvidence: sha256('round-1-execution'),
  });
  assert.equal(next.status, 'executing');
  assert.equal(next.activeCorrection, null);
  assert.equal(next.attemptedCorrections.length, 1);
  assert.equal(next.attemptedCorrections[0].validatedByReviewHash, null);
  assert.equal(next.attemptedCorrections[0].validationVerdict, null);
});

async function applyRound(authority, state, roundNumber, second) {
  let next = await advance(authority, state, 'rework-ready', second, {
    roundId: state.activeCorrection.roundId,
    outputCandidateHash: fixture.reviewRecords[roundNumber].review.candidateHash,
    executionEvidence: sha256(`round-${roundNumber}-execution`),
  });
  next = await advance(authority, next, 'execution-ready', second + 1);
  return advance(authority, next, 'review-started', second + 2);
}

test('three actual applied and failed rounds block without planning a fourth round', async () => {
  const authority = makeAuthority();
  let state = await reachReviewing(authority, await create(authority));
  state = await advance(authority, state, 'review-failed', 6, failureEvent(
    fixture.reviewRecords[0].review.reviewHash,
  ));
  const treatmentIds = [];
  for (let round = 1; round <= 3; round += 1) {
    treatmentIds.push(state.activeCorrection.treatmentId);
    assert.equal(
      state.activeCorrection.actionHash,
      stableSha256(state.activeCorrection.correction),
    );
    const second = 7 + ((round - 1) * 4);
    state = await applyRound(authority, state, round, second);
    state = await advance(authority, state, 'review-failed', second + 3, failureEvent(
      fixture.reviewRecords[round].review.reviewHash,
    ));
    if (round < 3) assert.equal(state.status, 'reworking');
  }
  assert.equal(state.status, 'blocked');
  assert.equal(state.activeCorrection, null);
  assert.equal(state.attemptedCorrections.length, 3);
  assert.equal(state.blockedReport.attemptedCorrections.length, 3);
  assert.deepEqual(treatmentIds, [
    'local-correction',
    'module-rebuild',
    'method-or-path-switch',
  ]);
  assert.deepEqual(
    state.attemptedCorrections.map((attempt) => attempt.treatmentId),
    treatmentIds,
  );
  for (const attempt of state.attemptedCorrections) {
    assert.notEqual(attempt.validatedByReviewHash, null);
    assert.match(attempt.validationVerdict, /^(?:rework|eliminated)$/u);
  }
  const fingerprint = state.attemptedCorrections[0].rootCauseFingerprint;
  assert.equal(state.rootCauseAttempts[fingerprint], 3);
});

test('business decision blocks immediately with zero attempted corrections', async () => {
  const reviewHash = fixture.reviewRecords[0].review.reviewHash;
  const authority = makeAuthority({
    diagnostics: {
      [reviewHash]: makeDiagnostic({
        requiresBusinessDecision: true,
        blockedReason: '需要帝王确认品牌方向',
        remainingRisks: ['方向未确认'],
        requestedBusinessInput: ['确认目标人群'],
      }),
    },
  });
  const reviewing = await reachReviewing(authority, await create(authority));
  const state = await advance(authority, reviewing, 'review-failed', 6, failureEvent(
    reviewHash,
  ));
  assert.equal(state.status, 'blocked');
  assert.equal(state.attemptedCorrections.length, 0);
  assert.equal(state.blockedReport.attemptedCorrections.length, 0);
});

test('same review hash cannot be reused anywhere in the timeline', async () => {
  const authority = makeAuthority();
  let state = await reachReviewing(authority, await create(authority));
  const hash = fixture.reviewRecords[0].review.reviewHash;
  state = await advance(authority, state, 'review-failed', 6, failureEvent(hash));
  state = await advance(authority, state, 'rework-ready', 7, {
    roundId: state.activeCorrection.roundId,
    outputCandidateHash: fixture.reviewRecords[1].review.candidateHash,
    executionEvidence: sha256('round-1'),
  });
  state = await advance(authority, state, 'execution-ready', 8);
  state = await advance(authority, state, 'review-started', 9);
  await assert.rejects(
    () => advance(authority, state, 'review-failed', 10, failureEvent(hash)),
    /reviewHash.*unique|already used/i,
  );
});

test('concurrent atomic commits yield exactly one success and one stale error', async () => {
  const authority = makeAuthority();
  const state = await create(authority);
  const results = await Promise.allSettled([
    advance(authority, state, 'start-planning', 1),
    advance(authority, state, 'start-planning', 1),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.equal(rejected.reason.code, 'STALE_DEBUG_STATE');
});

test('trusted full-state store detects truncated/rehash history and rollback', async () => {
  const authority = makeAuthority();
  const initial = await create(authority);
  let state = await advance(authority, initial, 'start-planning', 1);
  state = await advance(authority, state, 'plan-ready', 2);
  const forged = structuredClone(state);
  forged.timeline.pop();
  forged.status = 'planning';
  forged.revision -= 1;
  forged.previousStateHash = initial.stateHash;
  rehashTimelineAndState(forged);
  await assert.rejects(
    () => validateBrandDebugState(forged, authority.runtime),
    /trusted stored state|stored state mismatch/i,
  );
  authority.setStored(initial);
  await assert.rejects(
    () => validateBrandDebugState(state, authority.runtime),
    /trusted stored state|stored state mismatch/i,
  );
});

test('createdAt is the lower time bound, note is capped at 400, and huge strings fail early', async () => {
  const authority = makeAuthority();
  const state = await create(authority);
  await assert.rejects(
    () => advance(authority, state, 'start-planning', -1),
    /createdAt|earlier|date-time/i,
  );
  await assert.rejects(
    () => advance(authority, state, 'start-planning', 1, { note: 'x'.repeat(401) }),
    /note.*400/i,
  );
  await assert.rejects(
    () => createBrandDebugState({
      taskIdentity: TASK_IDENTITY,
      skillId: fixture.plan.skillId,
      planHash: fixture.plan.planHash,
      evidenceHash: fixture.evidenceBundle.evidenceHash,
      now: iso(0),
      huge: 'x'.repeat((1024 * 1024) + 1),
    }, makeAuthority().runtime),
    /1 MB|stable JSON limit/i,
  );
});

test('transient failures use atomic full-state commits and block on the third cause', async () => {
  const authority = makeAuthority();
  let state = await advance(authority, await create(authority), 'start-planning', 1);
  state = await advance(authority, state, 'transient-failure', 2, {
    transientCause: 'browser-timeout',
  });
  state = await advance(authority, state, 'transient-recovered', 3, {
    transientCause: 'browser-timeout',
  });
  state = await advance(authority, state, 'transient-failure', 4, {
    transientCause: 'browser-timeout',
  });
  state = await advance(authority, state, 'transient-recovered', 5, {
    transientCause: 'browser-timeout',
  });
  state = await advance(authority, state, 'transient-failure', 6, {
    transientCause: 'browser-timeout',
  });
  assert.equal(state.status, 'blocked');
  assert.equal(state.transientAttempts['browser-timeout'], 3);
  assert.equal(authority.readStored().revision, state.revision);
});

test('trustedRuntime is an exact four-function authority, not serializable caller data', async () => {
  const authority = makeAuthority();
  for (const removed of [
    'readStateHead',
    'compareAndSwapStateHead',
    'initializeStateHead',
  ]) {
    assert.equal(Object.hasOwn(authority.runtime, removed), false);
  }
  await assert.rejects(
    () => createBrandDebugState({
      taskIdentity: TASK_IDENTITY,
      skillId: fixture.plan.skillId,
      planHash: fixture.plan.planHash,
      evidenceHash: fixture.evidenceBundle.evidenceHash,
      now: iso(0),
    }, { ...authority.runtime, secret: 'caller-key' }),
    /exactly four|unknown field/i,
  );
  const missing = { ...authority.runtime };
  delete missing.resolveReview;
  await assert.rejects(
    () => createBrandDebugState({
      taskIdentity: TASK_IDENTITY,
      skillId: fixture.plan.skillId,
      planHash: fixture.plan.planHash,
      evidenceHash: fixture.evidenceBundle.evidenceHash,
      now: iso(0),
    }, missing),
    /missing|required|four/i,
  );
});

test('wrong resolver output is rejected without changing the stored state', async () => {
  const authority = makeAuthority();
  const reviewing = await reachReviewing(authority, await create(authority));
  const stored = authority.readStored();
  const wrongRuntime = Object.freeze({
    ...authority.runtime,
    async resolveReview() {
      return structuredClone({
        ...fixture.passedRecord,
        diagnostic: makeDiagnostic(),
      });
    },
  });
  await assert.rejects(
    () => advanceBrandDebugState({
      current: reviewing,
      event: {
        type: 'review-failed',
        ...failureEvent(fixture.reviewRecords[0].review.reviewHash),
      },
      now: iso(6),
    }, wrongRuntime),
    /wrong reviewHash|requires a real failed/i,
  );
  assert.deepEqual(authority.readStored(), stored);
});

test('an applied correction may pass review and then return through control center', async () => {
  const authority = makeAuthority();
  let state = await reachReviewing(authority, await create(authority));
  state = await advance(authority, state, 'review-failed', 6, failureEvent(
    fixture.reviewRecords[0].review.reviewHash,
  ));
  state = await advance(authority, state, 'rework-ready', 7, {
    roundId: state.activeCorrection.roundId,
    outputCandidateHash: fixture.passedRecord.review.candidateHash,
    executionEvidence: sha256('passing-rework'),
  });
  state = await advance(authority, state, 'execution-ready', 8);
  state = await advance(authority, state, 'review-started', 9);
  state = await advance(authority, state, 'review-passed', 10, {
    reviewHash: fixture.passedRecord.review.reviewHash,
  });
  assert.equal(state.attemptedCorrections[0].validationVerdict, 'candidate_ready');
  assert.deepEqual(state.rootCauseAttempts, {});
  state = await advance(authority, state, 'return-to-control-center', 11);
  assert.equal(state.status, 'returned_to_control_center');
  assert.equal(await validateBrandDebugState(state, authority.runtime), true);
});

test('explicit operational block preserves applied evidence and returns only through control center', async () => {
  const authority = makeAuthority();
  let state = await advance(authority, await create(authority), 'start-planning', 1);
  state = await advance(authority, state, 'block', 2, {
    blockedReason: '外部素材缺失',
    remainingRisks: ['无法确认产品原貌'],
    requestedBusinessInput: ['补充授权产品图'],
  });
  assert.equal(state.status, 'blocked');
  assert.equal(state.blockedReport.attemptedCorrections.length, 0);
  state = await advance(authority, state, 'return-to-control-center', 3);
  assert.equal(state.status, 'returned_to_control_center');
});

test('a failed review with a different derived root does not consume the corrected root count', async () => {
  const differentHash = fixture.reviewRecords[1].review.reviewHash;
  const authority = makeAuthority({
    diagnostics: {
      [differentHash]: makeDiagnostic({
        affectedModuleIds: ['category-positioning'],
      }),
    },
  });
  let state = await reachReviewing(authority, await create(authority));
  state = await advance(authority, state, 'review-failed', 6, failureEvent(
    fixture.reviewRecords[0].review.reviewHash,
  ));
  state = await applyRound(authority, state, 1, 7);
  state = await advance(authority, state, 'review-failed', 10, failureEvent(
    differentHash,
  ));
  assert.deepEqual(state.rootCauseAttempts, {});
  assert.equal(
    state.attemptedCorrections[0].validationVerdict,
    'failed-different-root-cause',
  );
  assert.notEqual(
    state.activeCorrection.rootCauseFingerprint,
    state.attemptedCorrections[0].rootCauseFingerprint,
  );
  assert.match(state.activeCorrection.roundId, /-1$/u);
});

test('A-root failure count resumes correctly after a B-root interruption', async () => {
  const differentHash = fixture.reviewRecords[2].review.reviewHash;
  const authority = makeAuthority({
    diagnostics: {
      [differentHash]: makeDiagnostic({
        affectedModuleIds: ['category-positioning'],
      }),
    },
  });
  let state = await reachReviewing(authority, await create(authority));
  state = await advance(authority, state, 'review-failed', 6, failureEvent(
    fixture.reviewRecords[0].review.reviewHash,
  ));
  state = await applyRound(authority, state, 1, 7);
  state = await advance(authority, state, 'review-failed', 10, failureEvent(
    fixture.reviewRecords[1].review.reviewHash,
  ));
  const fingerprintA = state.activeCorrection.rootCauseFingerprint;
  assert.equal(state.rootCauseAttempts[fingerprintA], 1);
  assert.match(state.activeCorrection.roundId, /-2$/u);

  state = await applyRound(authority, state, 2, 11);
  state = await advance(authority, state, 'review-failed', 14, failureEvent(
    differentHash,
  ));
  const fingerprintB = state.activeCorrection.rootCauseFingerprint;
  assert.notEqual(fingerprintB, fingerprintA);
  assert.equal(state.rootCauseAttempts[fingerprintA], 1);
  assert.match(state.activeCorrection.roundId, /-1$/u);

  state = await applyRound(authority, state, 3, 15);
  state = await advance(authority, state, 'review-failed', 18, failureEvent(
    fixture.reviewRecords[3].review.reviewHash,
  ));
  assert.equal(state.activeCorrection.rootCauseFingerprint, fingerprintA);
  assert.equal(state.rootCauseAttempts[fingerprintA], 1);
  assert.equal(state.rootCauseAttempts[fingerprintB], undefined);
  assert.match(state.activeCorrection.roundId, /-3$/u);
});

test('candidate lineage rejects A to B to A hash reuse while allowing output B review B', async () => {
  const authority = makeAuthority();
  let state = await reachReviewing(authority, await create(authority));
  state = await advance(authority, state, 'review-failed', 6, failureEvent(
    fixture.reviewRecords[0].review.reviewHash,
  ));
  state = await applyRound(authority, state, 1, 7);
  state = await advance(authority, state, 'review-failed', 10, failureEvent(
    fixture.reviewRecords[1].review.reviewHash,
  ));
  await assert.rejects(
    () => advance(authority, state, 'rework-ready', 11, {
      roundId: state.activeCorrection.roundId,
      outputCandidateHash: fixture.reviewRecords[0].review.candidateHash,
      executionEvidence: sha256('candidate-hash-rollback'),
    }),
    /candidate.*hash.*unique|candidate lineage|already used/i,
  );
});

test('candidate lineage rejects a reused candidateId even when its hash is new', async () => {
  const authority = makeAuthority();
  let state = await reachReviewing(authority, await create(authority));
  state = await advance(authority, state, 'review-failed', 6, failureEvent(
    fixture.reviewRecords[0].review.reviewHash,
  ));
  state = await advance(authority, state, 'rework-ready', 7, {
    roundId: state.activeCorrection.roundId,
    outputCandidateHash: fixture.reusedIdRecord.review.candidateHash,
    executionEvidence: sha256('candidate-id-reuse'),
  });
  state = await advance(authority, state, 'execution-ready', 8);
  state = await advance(authority, state, 'review-started', 9);
  await assert.rejects(
    () => advance(authority, state, 'review-failed', 10, failureEvent(
      fixture.reusedIdRecord.review.reviewHash,
    )),
    /candidateId.*unique|candidate lineage|already reviewed/i,
  );
});

test('blockedReport must equal the complete applied correction history exactly', async () => {
  const authority = makeAuthority();
  let state = await reachReviewing(authority, await create(authority));
  state = await advance(authority, state, 'review-failed', 6, failureEvent(
    fixture.reviewRecords[0].review.reviewHash,
  ));
  state = await advance(authority, state, 'rework-ready', 7, {
    roundId: state.activeCorrection.roundId,
    outputCandidateHash: fixture.reviewRecords[1].review.candidateHash,
    executionEvidence: sha256('blocked-history'),
  });
  state = await advance(authority, state, 'block', 8, {
    blockedReason: '外部依赖不可用',
    remainingRisks: ['返工产物尚未复审'],
    requestedBusinessInput: [],
  });
  assert.deepEqual(state.blockedReport.attemptedCorrections, state.attemptedCorrections);

  const forged = structuredClone(state);
  forged.blockedReport.attemptedCorrections = [];
  const blockEntry = forged.timeline.at(-1);
  blockEntry.blockedReportHash = stableSha256(forged.blockedReport);
  const { eventHash: ignoredEventHash, ...eventWithoutHash } = blockEntry;
  blockEntry.eventHash = stableSha256(eventWithoutHash);
  const { stateHash: ignoredStateHash, ...stateWithoutHash } = forged;
  forged.stateHash = stableSha256(stateWithoutHash);
  authority.setStored(forged);
  await assert.rejects(
    () => validateBrandDebugState(forged, authority.runtime),
    /complete.*history|exactly match|blockedReport.*attemptedCorrections/i,
  );
});

test('trusted diagnostic modules must be selected by the resolved trusted plan', async () => {
  const reviewHash = fixture.reviewRecords[0].review.reviewHash;
  const authority = makeAuthority({
    diagnostics: {
      [reviewHash]: makeDiagnostic({
        affectedModuleIds: ['differentiation-positioning'],
      }),
    },
  });
  const reviewing = await reachReviewing(authority, await create(authority));
  await assert.rejects(
    () => advance(authority, reviewing, 'review-failed', 6, failureEvent(reviewHash)),
    /diagnostic.*selectedModuleIds|selected module/i,
  );
});

test('treatment stage cannot be skipped or repeated after state rehashing', async () => {
  const authority = makeAuthority();
  let state = await reachReviewing(authority, await create(authority));
  state = await advance(authority, state, 'review-failed', 6, failureEvent(
    fixture.reviewRecords[0].review.reviewHash,
  ));
  const forgedSkip = structuredClone(state);
  forgedSkip.activeCorrection.treatmentId = 'module-rebuild';
  forgedSkip.activeCorrection.correction = 'module-rebuild: 篡改跳级';
  forgedSkip.activeCorrection.actionHash = stableSha256(
    forgedSkip.activeCorrection.correction,
  );
  const { stateHash: ignoredSkipHash, ...skipWithoutHash } = forgedSkip;
  forgedSkip.stateHash = stableSha256(skipWithoutHash);
  authority.setStored(forgedSkip);
  await assert.rejects(
    () => validateBrandDebugState(forgedSkip, authority.runtime),
    /treatment.*stage|skip|local-correction/i,
  );

  const authority2 = makeAuthority();
  let state2 = await reachReviewing(authority2, await create(authority2));
  state2 = await advance(authority2, state2, 'review-failed', 6, failureEvent(
    fixture.reviewRecords[0].review.reviewHash,
  ));
  state2 = await applyRound(authority2, state2, 1, 7);
  state2 = await advance(authority2, state2, 'review-failed', 10, failureEvent(
    fixture.reviewRecords[1].review.reviewHash,
  ));
  const forgedRepeat = structuredClone(state2);
  forgedRepeat.activeCorrection.treatmentId = 'local-correction';
  forgedRepeat.activeCorrection.correction = 'local-correction: 篡改重复';
  forgedRepeat.activeCorrection.actionHash = stableSha256(
    forgedRepeat.activeCorrection.correction,
  );
  const { stateHash: ignoredRepeatHash, ...repeatWithoutHash } = forgedRepeat;
  forgedRepeat.stateHash = stableSha256(repeatWithoutHash);
  authority2.setStored(forgedRepeat);
  await assert.rejects(
    () => validateBrandDebugState(forgedRepeat, authority2.runtime),
    /treatment.*stage|repeat|module-rebuild/i,
  );
});

test('atomic commit crash preserves the old stored state and permits retry', async () => {
  const authority = makeAuthority();
  const initial = await create(authority);
  authority.crashCommitOnce();
  await assert.rejects(
    () => advance(authority, initial, 'start-planning', 1),
    /simulated atomic commit crash/i,
  );
  assert.deepEqual(authority.readStored(), initial);
  assert.equal(await validateBrandDebugState(initial, authority.runtime), true);
  const recovered = await advance(authority, initial, 'start-planning', 1);
  assert.equal(recovered.status, 'planning');
});

test('successful commit is recoverable from trusted storage without caller-side saving', async () => {
  const authority = makeAuthority();
  const initial = await create(authority);
  await advance(authority, initial, 'start-planning', 1);
  const recovered = await authority.runtime.readDebugState(TASK_IDENTITY);
  assert.equal(recovered.status, 'planning');
  assert.equal(recovered.revision, 1);
  assert.equal(await validateBrandDebugState(recovered, authority.runtime), true);
});

test('JSON recovery retains the trusted revision and can continue advancing', async () => {
  const authority = makeAuthority();
  let state = await advance(authority, await create(authority), 'start-planning', 1);
  state = JSON.parse(JSON.stringify(state));
  state = await advance(authority, state, 'plan-ready', 2);
  assert.equal(state.revision, 2);
  assert.equal(await validateBrandDebugState(state, authority.runtime), true);
});

test('structural replay rejects forged status even if a cooperating test store accepts it', async () => {
  const authority = makeAuthority();
  const state = await advance(authority, await create(authority), 'start-planning', 1);
  const forged = structuredClone(state);
  forged.status = 'candidate_ready';
  const { stateHash: ignored, ...withoutHash } = forged;
  forged.stateHash = stableSha256(withoutHash);
  authority.setStored(forged);
  await assert.rejects(
    () => validateBrandDebugState(forged, authority.runtime),
    /replay status mismatch/i,
  );
});

test('snapshot rejects accessors and oversized arrays before state mutation', async () => {
  const authority = makeAuthority();
  const state = await create(authority);
  const accessorEvent = { type: 'start-planning' };
  Object.defineProperty(accessorEvent, 'note', {
    enumerable: true,
    get() {
      throw new Error('getter must not run');
    },
  });
  await assert.rejects(
    () => advanceBrandDebugState({
      current: state,
      event: accessorEvent,
      now: iso(1),
    }, authority.runtime),
    /accessor|descriptor/i,
  );
  const huge = [];
  huge.length = 10_001;
  await assert.rejects(
    () => advanceBrandDebugState({
      current: state,
      event: { type: 'start-planning', huge },
      now: iso(1),
    }, authority.runtime),
    /array is too large/i,
  );
  assert.deepEqual(authority.readStored(), state);
});

test('schema explicitly declares structural-only enforcement and trusted runtime constraints', async () => {
  const schema = JSON.parse(await fs.readFile(SCHEMA_FILE, 'utf8'));
  assert.match(schema.description, /structural only|结构/i);
  assert.deepEqual(schema.required, ROOT_FIELDS);
  for (const constraint of [
    'trusted-full-state-atomic-store',
    'trusted-review-resolver',
    'trusted-diagnostic-modules',
    'three-stage-treatment',
    'three-applied-rounds',
    'root-cause-derived',
    'schema-structural-only',
  ]) {
    assert.ok(schema['x-runtimeConstraints'].includes(constraint));
  }
  for (const field of ['treatmentId', 'actionHash']) {
    assert.ok(schema.$defs.activeCorrection.required.includes(field));
    assert.ok(schema.$defs.appliedCorrection.required.includes(field));
  }
  assert.ok(schema.$defs.appliedCorrection.required.includes('executionEvidence'));
  assert.ok(
    schema.$defs.appliedCorrection.properties.validationVerdict.anyOf[0].enum
      .includes('failed-different-root-cause'),
  );
  assert.ok(schema.$defs.timelineEvent.required.includes('previousEventHash'));
  assert.ok(schema.$defs.timelineEvent.required.includes('eventHash'));
  for (const constraint of [
    'candidate-lineage-unique',
    'blocked-report-complete-history',
    'different-root-cause-does-not-count',
  ]) {
    assert.ok(schema['x-runtimeConstraints'].includes(constraint));
  }
});
