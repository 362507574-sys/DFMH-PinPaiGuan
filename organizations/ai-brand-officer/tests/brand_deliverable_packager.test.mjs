import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createBrandDebugState,
  advanceBrandDebugState,
} from '../scripts/brand_debug_controller.mjs';
import {
  packageBrandDeliverable,
  validateBrandDeliverablePackage,
} from '../scripts/brand_deliverable_packager.mjs';
import {
  buildBrandEvidenceBundle,
} from '../scripts/brand_evidence_engine.mjs';
import {
  evaluateBrandCandidate,
} from '../scripts/brand_quality_gate.mjs';
import {
  buildBrandTaskPlan,
} from '../scripts/brand_task_planner.mjs';
import {
  stableSha256,
  stableStringify,
} from '../scripts/brand_contracts.mjs';
import {
  createKnowledgeContext,
} from '../../../scripts/feishu-commander/knowledge_context.mjs';

const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(
  TEST_ROOT,
  '..',
  'contracts',
  'brand-deliverable-package.schema.json',
);
const IDENTITY = Object.freeze({
  enterpriseId: 'enterprise-001',
  businessProjectId: 'project-001',
  taskId: 'brand-task-001',
});
const REVIEWER_BINDINGS = Object.freeze({
  ruleReviewerId: 'reviewer-rule-001',
  professionalReviewerId: 'reviewer-brand-001',
});
const HASH_A = 'a'.repeat(64);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertDeepFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function passingReviewInput(score = 91) {
  return {
    ruleReview: {
      reviewId: 'rule-review-001',
      reviewerId: REVIEWER_BINDINGS.ruleReviewerId,
      reviewerRole: 'rule-engine',
      passed: true,
      failedCriteria: [],
      hardVetoes: [],
    },
    professionalReview: {
      reviewId: 'professional-review-001',
      reviewerId: REVIEWER_BINDINGS.professionalReviewerId,
      reviewerRole: 'brand-professional-reviewer',
      passed: true,
      score,
      observations: ['The candidate is supported by the bound evidence.'],
      correctionTargets: [],
    },
  };
}

function reworkReviewInput() {
  return {
    ruleReview: {
      reviewId: 'rule-review-rework',
      reviewerId: REVIEWER_BINDINGS.ruleReviewerId,
      reviewerRole: 'rule-engine',
      passed: true,
      failedCriteria: [],
      hardVetoes: [],
    },
    professionalReview: {
      reviewId: 'professional-review-rework',
      reviewerId: REVIEWER_BINDINGS.professionalReviewerId,
      reviewerRole: 'brand-professional-reviewer',
      passed: false,
      score: 75,
      observations: ['The differentiation is still too broad.'],
      correctionTargets: ['Narrow the differentiation to one defensible claim.'],
    },
  };
}

async function makeGraph({
  artifactVersion = 1,
  candidateText = 'A focused and evidence-backed positioning candidate.',
  score = 91,
  rework = false,
  advanceReview = true,
  planningNote,
  conversationConfidence = 'confirmed',
  deliveryContextOverrides = {},
} = {}) {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'brand-packager-'));
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
    taskSummary: 'Build a trusted Task6 deliverable fixture.',
    capabilityId: 'brand-positioning',
    spaces: [
      { name: '老雷知识库', spaceId: 'space-laolei' },
      { name: '老雷课件知识库', spaceId: 'space-courseware' },
    ],
    queries: ['brand positioning'],
    sources: [],
    unreadCandidates: [],
    degradedReason: '',
  });
  const receiptBytes = Buffer.from(JSON.stringify(receipt, null, 2), 'utf8');
  await fs.mkdir(path.dirname(path.resolve(projectRoot, receiptPath)), {
    recursive: true,
  });
  await fs.writeFile(path.resolve(projectRoot, receiptPath), receiptBytes);

  const artifact = {
    artifactId: 'strategy-input',
    version: artifactVersion,
    sha256: HASH_A,
    sourceOrganizationId: 'ai-helm-officer',
  };
  const evidenceTrustedOptions = {
    projectRoot,
    projectContext: {
      schemaVersion: 1,
      taskId: IDENTITY.taskId,
      enterpriseId: IDENTITY.enterpriseId,
      businessProjectId: IDENTITY.businessProjectId,
      projectContextVersion: 1,
      readableArtifacts: [artifact],
    },
    receiptBinding: {
      receiptPath,
      receiptSha256: sha256(receiptBytes),
    },
  };
  const plan = buildBrandTaskPlan({
    ...IDENTITY,
    skillId: 'brand-positioning',
    goal: 'Create one defensible differentiation positioning result.',
    requestedModuleIds: ['differentiation-positioning'],
    availableInputs: {},
    constraints: {},
    upstreamArtifacts: [artifact],
  });
  const evidenceBundle = await buildBrandEvidenceBundle({
    taskIdentity: { ...IDENTITY },
    skillId: 'brand-positioning',
    conversationFacts: [{
      id: 'conversation-positioning',
      claim: 'The owner selected one primary positioning direction.',
      sourceRef: 'conversation:turn-001',
      confidence: conversationConfidence,
    }],
    publicSources: [],
    professionalJudgments: [{
      id: 'judgment-positioning',
      category: 'professional-judgment',
      claim: 'The final claim must be narrow enough to defend.',
      sourceRef: 'brand-officer:judgment',
      confidence: 'supported',
    }],
    requestedUpstreamArtifacts: [artifact],
    criticalUnknowns: [],
  }, evidenceTrustedOptions);
  const baseCandidateWithoutHash = {
    candidateId: rework ? 'candidate-rework' : 'candidate-ready',
    ...IDENTITY,
    skillId: 'brand-positioning',
    content: {
      sections: [{
        sectionId: 'positioning-result',
        content: candidateText,
      }],
    },
  };
  const baseCandidateHash = stableSha256(baseCandidateWithoutHash);
  const deliveryContext = {
    businessConclusion: candidateText,
    recommendedCandidate: baseCandidateWithoutHash.candidateId,
    confirmedConclusions: [candidateText],
    riskNotes: [],
    decisionRequests: [],
    mustPreserve: [...plan.acceptanceCriteria],
    mayAdapt: [],
    forbiddenChanges: [...plan.stopConditions],
    nextOrganizationRecommendation: null,
    ...deliveryContextOverrides,
  };
  const executionContextCommitment = stableSha256({
    deliveryContext,
    baseCandidateHash,
    taskIdentity: { ...IDENTITY },
    skillId: plan.skillId,
    planHash: plan.planHash,
    evidenceHash: evidenceBundle.evidenceHash,
  });
  const candidateWithoutHash = {
    ...baseCandidateWithoutHash,
    content: {
      ...baseCandidateWithoutHash.content,
      _brandDeliveryContextCommitment: executionContextCommitment,
    },
  };
  const candidate = {
    ...candidateWithoutHash,
    candidateHash: stableSha256(candidateWithoutHash),
  };
  const reviewTrustedOptions = {
    plan,
    evidenceBundle,
    evidenceTrustedOptions,
    candidate,
    reviewerBindings: { ...REVIEWER_BINDINGS },
  };
  const review = await evaluateBrandCandidate(
    rework ? reworkReviewInput() : passingReviewInput(score),
    reviewTrustedOptions,
  );
  const diagnostic = {
    affectedModuleIds: ['differentiation-positioning'],
    correction: review.correctionTargets.join(' ') || 'No correction is required.',
    requiresBusinessDecision: false,
    blockedReason: '',
    remainingRisks: [],
    requestedBusinessInput: [],
  };
  let storedState = null;
  const debugTrustedRuntime = {
    async resolveReview(reviewHash) {
      if (reviewHash !== review.reviewHash) throw new Error('review not found');
      return { review, reviewTrustedOptions, diagnostic };
    },
    async initializeDebugState({ state }) {
      if (storedState !== null) return false;
      storedState = structuredClone(state);
      return true;
    },
    async readDebugState() {
      return storedState === null ? null : structuredClone(storedState);
    },
    async commitDebugState({
      expectedRevision,
      expectedStateHash,
      nextState,
    }) {
      if (
        storedState?.revision !== expectedRevision
        || storedState?.stateHash !== expectedStateHash
      ) return false;
      storedState = structuredClone(nextState);
      return true;
    },
  };
  let debugState = await createBrandDebugState({
    taskIdentity: { ...IDENTITY },
    skillId: plan.skillId,
    planHash: plan.planHash,
    evidenceHash: evidenceBundle.evidenceHash,
    now: '2026-07-29T08:01:00.000Z',
  }, debugTrustedRuntime);
  const advance = async (event, second) => {
    debugState = await advanceBrandDebugState({
      current: debugState,
      event,
      now: second,
    }, debugTrustedRuntime);
  };
  await advance({
    type: 'start-planning',
    ...(planningNote === undefined ? {} : { note: planningNote }),
  }, '2026-07-29T08:01:01.000Z');
  await advance({ type: 'plan-ready' }, '2026-07-29T08:01:02.000Z');
  await advance({ type: 'evidence-ready' }, '2026-07-29T08:01:03.000Z');
  await advance({ type: 'execution-ready' }, '2026-07-29T08:01:04.000Z');
  await advance({ type: 'review-started' }, '2026-07-29T08:01:05.000Z');
  if (advanceReview) {
    await advance({
      type: rework ? 'review-failed' : 'review-passed',
      reviewHash: review.reviewHash,
    }, '2026-07-29T08:01:06.000Z');
  }
  return {
    projectRoot,
    plan,
    evidenceBundle,
    candidate,
    review,
    debugState,
    trustedOptions: {
      evidenceTrustedOptions,
      reviewTrustedOptions,
      debugTrustedRuntime,
      deliveryContext,
      baseCandidateHash,
      executionContextCommitment,
      deliveryContextCommitment: stableSha256({
        deliveryContext,
        baseCandidateHash,
        candidateHash: candidate.candidateHash,
        reviewHash: review.reviewHash,
        taskIdentity: { ...IDENTITY },
        skillId: plan.skillId,
        planHash: plan.planHash,
        evidenceHash: evidenceBundle.evidenceHash,
        executionContextCommitment,
      }),
    },
  };
}

async function cleanupGraphs(graphs) {
  await Promise.all(graphs.map(
    (graph) => fs.rm(graph.projectRoot, { recursive: true, force: true }),
  ));
}

test('packages a passing candidate into a deeply frozen human and system layer', async (t) => {
  const graph = await makeGraph();
  t.after(() => cleanupGraphs([graph]));
  const input = {
    plan: graph.plan,
    evidenceBundle: graph.evidenceBundle,
    candidate: graph.candidate,
    review: graph.review,
    debugState: graph.debugState,
  };
  const before = stableStringify(input);
  const result = await packageBrandDeliverable(input, graph.trustedOptions);

  assert.equal(stableStringify(input), before);
  assert.deepEqual(Object.keys(result).sort(), [
    'humanSummary',
    'sha256',
    'systemPackage',
  ]);
  assert.match(result.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(
    result.sha256,
    stableSha256({
      humanSummary: result.humanSummary,
      systemPackage: result.systemPackage,
    }),
  );
  assert.doesNotMatch(result.humanSummary.conclusion, /candidate-ready/iu);
  assert.match(result.humanSummary.conclusion, /已通过审核|候选方案/u);
  assert.ok(result.humanSummary.basis.length > 0);
  assert.deepEqual(result.humanSummary.limitations, ['feishu-no-hit']);
  assert.ok(result.humanSummary.nextStep.length > 0);

  const system = result.systemPackage;
  assert.equal(system.schemaVersion, 1);
  assert.deepEqual(system.taskIdentity, IDENTITY);
  assert.equal(system.skillId, 'brand-positioning');
  assert.deepEqual(system.selectedModuleIds, ['differentiation-positioning']);
  assert.equal(system.candidateId, graph.candidate.candidateId);
  assert.equal(system.planHash, graph.plan.planHash);
  assert.equal(system.evidenceHash, graph.evidenceBundle.evidenceHash);
  assert.equal(system.candidateHash, graph.candidate.candidateHash);
  assert.equal(system.reviewHash, graph.review.reviewHash);
  assert.equal(system.debugStateHash, graph.debugState.stateHash);
  assert.equal(system.output.candidateId, graph.candidate.candidateId);
  assert.equal(system.output.candidateHash, graph.candidate.candidateHash);
  assert.equal(system.output.contentSha256, stableSha256(graph.candidate.content));
  assert.equal(
    JSON.parse(system.output.contentJson).sections[0].content,
    graph.candidate.content.sections[0].content,
  );
  assert.deepEqual(system.upstreamArtifacts, graph.plan.upstreamArtifacts);
  assert.deepEqual(
    system.evidenceRefs.map((item) => item.evidenceId),
    graph.evidenceBundle.entries.map((item) => item.evidenceId),
  );
  assert.equal(system.review.verdict, 'preferred');
  assert.equal(system.debugTrace.status, 'candidate_ready');
  assert.equal(system.artifactVersion, 1);
  assert.equal(system.artifactStatus, 'organization_candidate');
  assert.equal(system.lifecycleStatus, 'candidate_ready');
  assert.match(system.deliveryContextCommitment, /^[a-f0-9]{64}$/u);
  assert.equal(system.baseCandidateHash, graph.trustedOptions.baseCandidateHash);
  assert.equal(
    system.executionContextCommitment,
    graph.trustedOptions.executionContextCommitment,
  );
  assert.equal(
    JSON.parse(system.output.contentJson)._brandDeliveryContextCommitment,
    system.executionContextCommitment,
  );
  assert.match(system.businessContent.businessConclusion, /focused and evidence-backed/iu);
  assert.deepEqual(
    system.businessContent.facts
      .filter((item) => item.category === 'conversation')
      .map((item) => item.claim),
    ['The owner selected one primary positioning direction.'],
  );
  assert.ok(system.businessContent.judgments.some(
    (item) => /narrow enough to defend/iu.test(item.claim),
  ));
  assert.deepEqual(
    system.downstreamInstructions.mustPreserve,
    graph.plan.acceptanceCriteria,
  );
  assert.deepEqual(
    system.downstreamInstructions.forbiddenChanges,
    graph.plan.stopConditions,
  );
  assert.deepEqual(system.eliminationAndReworkHistory, []);
  assert.equal(
    JSON.parse(system.debugTrace.stateJson).stateHash,
    graph.debugState.stateHash,
  );
  assert.equal(
    system.debugTrace.stateSha256,
    stableSha256(graph.debugState),
  );
  assert.match(result.humanSummary.conclusion, /focused and evidence-backed/iu);
  assert.ok(result.humanSummary.basis.some(
    (item) => /differentiation-positioning/u.test(item),
  ));
  assert.equal(
    system.debugTrace.timeline.at(-1).eventType,
    'review-passed',
  );
  assert.deepEqual(validateBrandDeliverablePackage(result), result);
  const unknownTopPackageHash = structuredClone(result);
  unknownTopPackageHash.packageHash = result.sha256;
  assert.throws(
    () => validateBrandDeliverablePackage(unknownTopPackageHash),
    /unknown.*packageHash|packageHash.*unknown/u,
  );
  const unknownSystemPackageHash = structuredClone(result);
  unknownSystemPackageHash.systemPackage.packageHash = result.sha256;
  unknownSystemPackageHash.sha256 = stableSha256({
    humanSummary: unknownSystemPackageHash.humanSummary,
    systemPackage: unknownSystemPackageHash.systemPackage,
  });
  assert.throws(
    () => validateBrandDeliverablePackage(unknownSystemPackageHash),
    /unknown.*packageHash|packageHash.*unknown/u,
  );
  assertDeepFrozen(result);
});

test('deterministically de-duplicates and caps maximum legal summary inputs', async (t) => {
  const graph = await makeGraph({
    deliveryContextOverrides: {
      confirmedConclusions: Array.from(
        { length: 100 },
        (_, index) => `Confirmed conclusion ${index + 1}.`,
      ),
      riskNotes: Array.from(
        { length: 100 },
        (_, index) => `Risk note ${index + 1}.`,
      ),
    },
  });
  t.after(() => cleanupGraphs([graph]));
  const result = await packageBrandDeliverable({
    plan: graph.plan,
    evidenceBundle: graph.evidenceBundle,
    candidate: graph.candidate,
    review: graph.review,
    debugState: graph.debugState,
  }, graph.trustedOptions);

  assert.equal(result.humanSummary.basis.length, 100);
  assert.equal(result.humanSummary.limitations.length, 100);
  assert.match(result.humanSummary.basis.at(-1), /另有 \d+ 项已省略/u);
  assert.match(result.humanSummary.limitations.at(-1), /另有 \d+ 项已省略/u);
  assert.equal(
    new Set(result.humanSummary.basis).size,
    result.humanSummary.basis.length,
  );
  assert.doesNotThrow(() => validateBrandDeliverablePackage(result));
});

test('provisional evidence is not promoted to fact or a confirmed conclusion', async (t) => {
  const graph = await makeGraph({ conversationConfidence: 'provisional' });
  t.after(() => cleanupGraphs([graph]));
  const result = await packageBrandDeliverable({
    plan: graph.plan,
    evidenceBundle: graph.evidenceBundle,
    candidate: graph.candidate,
    review: graph.review,
    debugState: graph.debugState,
  }, graph.trustedOptions);
  const provisionalClaim = 'The owner selected one primary positioning direction.';
  assert.equal(
    result.systemPackage.businessContent.facts.some(
      (item) => item.claim === provisionalClaim,
    ),
    false,
  );
  assert.equal(
    result.systemPackage.businessContent.assumptions.some(
      (item) => item.claim === provisionalClaim
        && item.confidence === 'provisional',
    ),
    true,
  );
  assert.equal(
    result.systemPackage.businessContent.confirmedConclusions.includes(
      provisionalClaim,
    ),
    false,
  );
  assert.equal(
    result.humanSummary.basis.some((item) => item.includes(provisionalClaim)),
    false,
  );
  assert.equal(
    result.humanSummary.limitations.some(
      (item) => item.includes(provisionalClaim),
    ),
    true,
  );
});

test('rejects rework, a non-candidate debug state, and binding/hash drift', async (t) => {
  const rework = await makeGraph({ rework: true });
  const reviewing = await makeGraph({ advanceReview: false });
  const ready = await makeGraph();
  t.after(() => cleanupGraphs([rework, reviewing, ready]));

  await assert.rejects(
    packageBrandDeliverable({
      plan: rework.plan,
      evidenceBundle: rework.evidenceBundle,
      candidate: rework.candidate,
      review: rework.review,
      debugState: rework.debugState,
    }, rework.trustedOptions),
    /passing|candidate_ready|preferred/u,
  );
  await assert.rejects(
    packageBrandDeliverable({
      plan: reviewing.plan,
      evidenceBundle: reviewing.evidenceBundle,
      candidate: reviewing.candidate,
      review: reviewing.review,
      debugState: reviewing.debugState,
    }, reviewing.trustedOptions),
    /candidate_ready/u,
  );

  const forgedPlan = structuredClone(ready.plan);
  forgedPlan.taskId = 'other-task';
  await assert.rejects(
    packageBrandDeliverable({
      plan: forgedPlan,
      evidenceBundle: ready.evidenceBundle,
      candidate: ready.candidate,
      review: ready.review,
      debugState: ready.debugState,
    }, ready.trustedOptions),
    /planHash|match|task/u,
  );
  const forgedCandidate = structuredClone(ready.candidate);
  forgedCandidate.content.sections[0].content = 'forged';
  await assert.rejects(
    packageBrandDeliverable({
      plan: ready.plan,
      evidenceBundle: ready.evidenceBundle,
      candidate: forgedCandidate,
      review: ready.review,
      debugState: ready.debugState,
    }, ready.trustedOptions),
    /candidateHash/u,
  );
});

test('content hash is stable and changes for every bound upstream layer', async (t) => {
  const base = await makeGraph();
  const artifactChanged = await makeGraph({ artifactVersion: 2 });
  const candidateChanged = await makeGraph({ candidateText: 'A changed candidate.' });
  const reviewChanged = await makeGraph({ score: 92 });
  const debugChanged = await makeGraph({ planningNote: 'restored planning trace' });
  const graphs = [
    base,
    artifactChanged,
    candidateChanged,
    reviewChanged,
    debugChanged,
  ];
  t.after(() => cleanupGraphs(graphs));

  const invoke = (graph) => packageBrandDeliverable({
    plan: graph.plan,
    evidenceBundle: graph.evidenceBundle,
    candidate: graph.candidate,
    review: graph.review,
    debugState: graph.debugState,
  }, graph.trustedOptions);
  const first = await invoke(base);
  const repeated = await invoke(base);
  assert.equal(first.sha256, repeated.sha256);
  for (const graph of graphs.slice(1)) {
    assert.notEqual(first.sha256, (await invoke(graph)).sha256);
  }
});

test('rejects proxy/unknown input and exposes a strict 2020-12 package schema', async (t) => {
  const graph = await makeGraph();
  t.after(() => cleanupGraphs([graph]));
  const input = {
    plan: graph.plan,
    evidenceBundle: graph.evidenceBundle,
    candidate: graph.candidate,
    review: graph.review,
    debugState: graph.debugState,
  };
  await assert.rejects(
    packageBrandDeliverable({ ...input, publish: true }, graph.trustedOptions),
    /unknown field/u,
  );
  await assert.rejects(
    packageBrandDeliverable(new Proxy(input, {}), graph.trustedOptions),
    /Proxy/u,
  );

  const schema = JSON.parse(await fs.readFile(SCHEMA_PATH, 'utf8'));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
  assert.equal(schema.properties.humanSummary.additionalProperties, false);
  assert.equal(schema.properties.systemPackage.additionalProperties, false);
  assert.ok(schema['x-runtimeConstraints'].some(
    (item) => /content fingerprint.*not.*signature/iu.test(item),
  ));
  assert.ok(schema['x-runtimeConstraints'].some(
    (item) => /shared-artifacts/iu.test(item),
  ));
  assert.ok(schema['x-runtimeConstraints'].some(
    (item) => /validators/iu.test(item),
  ));
});

test('runtime package validator rejects unknown fields and the 1 MiB UTF-8 content budget', async (t) => {
  const graph = await makeGraph();
  t.after(() => cleanupGraphs([graph]));
  const packageValue = await packageBrandDeliverable({
    plan: graph.plan,
    evidenceBundle: graph.evidenceBundle,
    candidate: graph.candidate,
    review: graph.review,
    debugState: graph.debugState,
  }, graph.trustedOptions);

  const extra = structuredClone(packageValue);
  extra.systemPackage.publish = true;
  assert.throws(
    () => validateBrandDeliverablePackage(extra),
    /unknown field/iu,
  );

  const oversized = structuredClone(packageValue);
  oversized.systemPackage.output.contentJson = JSON.stringify({
    body: '界'.repeat(400_000),
  });
  oversized.systemPackage.output.contentSha256 = stableSha256(
    JSON.parse(oversized.systemPackage.output.contentJson),
  );
  oversized.sha256 = stableSha256({
    humanSummary: oversized.humanSummary,
    systemPackage: oversized.systemPackage,
  });
  assert.ok(
    Buffer.byteLength(oversized.systemPackage.output.contentJson, 'utf8')
      > 1024 * 1024,
  );
  assert.throws(
    () => validateBrandDeliverablePackage(oversized),
    /1 MiB|1048576|byte budget/iu,
  );
});
