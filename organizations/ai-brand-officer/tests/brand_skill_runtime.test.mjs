import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  createBrandDebugState,
  advanceBrandDebugState,
} from '../scripts/brand_debug_controller.mjs';
import {
  stableSha256,
  stableStringify,
} from '../scripts/brand_contracts.mjs';
import {
  createBrandProjectWorkspace,
} from '../scripts/brand_project_workspace.mjs';
import {
  buildBrandTaskPlan,
} from '../scripts/brand_task_planner.mjs';
import {
  buildBrandEvidenceBundle,
} from '../scripts/brand_evidence_engine.mjs';
import {
  evaluateBrandCandidate,
} from '../scripts/brand_quality_gate.mjs';
import {
  createFileBackedBrandDebugRuntime,
  runBrandSkillRuntime,
} from '../scripts/brand_skill_runtime.mjs';
import {
  createKnowledgeContext,
} from '../../../scripts/feishu-commander/knowledge_context.mjs';
import {
  writeJsonAtomic,
} from '../../../scripts/feishu-commander/atomic_store.mjs';
import {
  makeBrandRuntimeFixture,
} from './helpers/brand_runtime_fixture.mjs';

const RULE_REVIEWER_ID = 'reviewer-rule-001';
const PROFESSIONAL_REVIEWER_ID = 'reviewer-brand-001';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function makeReview(index, { pass = true, score = pass ? 91 : 75 } = {}) {
  return {
    ruleReview: {
      reviewId: `rule-review-${index}`,
      reviewerId: RULE_REVIEWER_ID,
      reviewerRole: 'rule-engine',
      passed: true,
      failedCriteria: [],
      hardVetoes: [],
    },
    professionalReview: {
      reviewId: `professional-review-${index}`,
      reviewerId: PROFESSIONAL_REVIEWER_ID,
      reviewerRole: 'brand-professional-reviewer',
      passed: pass,
      score,
      observations: [
        pass
          ? 'The candidate is ready for the control center.'
          : 'The candidate still needs a narrower differentiation.',
      ],
      correctionTargets: pass
        ? []
        : ['Narrow the differentiation to one evidence-backed claim.'],
    },
    affectedModuleIds: ['differentiation-positioning'],
    requiresBusinessDecision: false,
    blockedReason: '',
    remainingRisks: pass ? [] : ['The current claim remains too broad.'],
    requestedBusinessInput: [],
  };
}

function makeDeliveryContext(candidateId = 'candidate-1') {
  return {
    businessConclusion: '帝王专属的窄定位结论。',
    recommendedCandidate: candidateId,
    confirmedConclusions: ['采用单一、可证明的差异化定位。'],
    riskNotes: ['仍需在下一组织验证渠道适配性。'],
    decisionRequests: [],
    mustPreserve: ['保留单一差异化主张。'],
    mayAdapt: ['表达语气可按渠道调整。'],
    forbiddenChanges: ['不得扩大为未经证据支持的承诺。'],
    nextOrganizationRecommendation: {
      organizationId: 'ai-growth-strategy-officer',
      reason: '验证定位与增长渠道的适配性。',
    },
  };
}

async function makeRuntimeCase(t, {
  criticalUnknowns = [],
  reviews = [makeReview(1)],
  throwExecute = false,
  throwReview = false,
} = {}) {
  const fixture = await makeBrandRuntimeFixture(t);
  const receiptPath = [
    'business-projects',
    fixture.enterpriseId,
    fixture.businessProjectId,
    'organizations',
    'ai-brand-officer',
    'tasks',
    fixture.taskId,
    'evidence',
    'knowledge',
    'knowledge_context.json',
  ].join('/');
  const receipt = createKnowledgeContext({
    schemaVersion: 1,
    requestId: fixture.taskId,
    generatedAt: '2026-07-29T00:00:00.000Z',
    status: 'no_hit',
    taskSummary: 'Exercise the real Task6 runtime and receipt binding.',
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
  await fs.mkdir(
    path.dirname(path.resolve(fixture.projectRoot, receiptPath)),
    { recursive: true },
  );
  await fs.writeFile(path.resolve(fixture.projectRoot, receiptPath), receiptBytes);
  let executeCount = 0;
  let reviewCount = 0;
  const executeCalls = [];
  const reviewCalls = [];
  let clock = 0;
  const request = {
    taskIdentity: { ...fixture.identity },
    skillId: 'brand-positioning',
    goal: 'Create one defensible differentiation positioning result.',
    requestedModuleIds: ['differentiation-positioning'],
    availableInputs: {},
    constraints: {},
    conversationFacts: [{
      id: 'conversation-positioning',
      claim: 'The owner chose one primary positioning direction.',
      sourceRef: 'conversation:turn-001',
      confidence: 'confirmed',
    }],
    publicSources: [],
    professionalJudgments: [{
      id: 'judgment-positioning',
      category: 'professional-judgment',
      claim: 'The final claim must be narrow enough to defend.',
      sourceRef: 'brand-officer:judgment',
      confidence: 'supported',
    }],
    criticalUnknowns,
  };
  const trustedOptions = {
    projectRoot: fixture.projectRoot,
    projectContext: {
      schemaVersion: 1,
      taskId: fixture.taskId,
      enterpriseId: fixture.enterpriseId,
      businessProjectId: fixture.businessProjectId,
      projectContextVersion: 1,
      readableArtifacts: [],
    },
    receiptBinding: {
      receiptPath,
      receiptSha256: sha256(receiptBytes),
    },
    async executeModules(input) {
      executeCalls.push(structuredClone(input));
      executeCount += 1;
      if (throwExecute) throw new Error('module execution failed');
      const candidateWithoutHash = {
        candidateId: `candidate-${executeCount}`,
        taskId: fixture.taskId,
        enterpriseId: fixture.enterpriseId,
        businessProjectId: fixture.businessProjectId,
        skillId: 'brand-positioning',
        content: {
          sections: [{
            sectionId: 'positioning-result',
            content: `Candidate round ${executeCount}.`,
          }],
        },
      };
      return {
        ...candidateWithoutHash,
        candidateHash: stableSha256(candidateWithoutHash),
      };
    },
    async reviewCandidate(input) {
      reviewCalls.push(structuredClone(input));
      if (throwReview) throw new Error('review callback failed');
      const selected = reviews[Math.min(reviewCount, reviews.length - 1)];
      reviewCount += 1;
      return structuredClone(selected);
    },
    reviewerBindings: {
      ruleReviewerId: RULE_REVIEWER_ID,
      professionalReviewerId: PROFESSIONAL_REVIEWER_ID,
    },
    now() {
      const result = new Date(Date.parse(fixture.fixedNow) + clock * 1000);
      clock += 1;
      return result;
    },
  };
  return {
    fixture,
    request,
    trustedOptions,
    executeCalls,
    reviewCalls,
    counts: {
      get execute() { return executeCount; },
      get review() { return reviewCount; },
    },
  };
}

async function makeVisualRuntimeCase(t, {
  duplicateDirections = false,
  includePublicHandoff = false,
  publicSkillIds = [],
} = {}) {
  const fixture = await makeBrandRuntimeFixture(t);
  const projectRecord = {
    ...fixture.projectRecord,
    publicSkillIds,
  };
  const projectBytes = Buffer.from(
    `${JSON.stringify(projectRecord, null, 2)}\n`,
    'utf8',
  );
  await fs.writeFile(fixture.projectFile, projectBytes);

  const registry = {
    schemaVersion: 1,
    publicSkills: [{
      id: 'public.promotional-poster',
      displayName: '普通宣传海报',
      capabilityId: 'promotional-poster',
      maturity: 'operational',
      allowedOrganizations: ['ai-brand-officer'],
      defaultPrimaryOrganization: 'ai-brand-officer',
    }],
  };
  const registryBytes = Buffer.from(
    `${JSON.stringify(registry, null, 2)}\n`,
    'utf8',
  );
  const registryPath = path.join(
    fixture.projectRoot,
    'public-skills',
    'registry.json',
  );
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(registryPath, registryBytes);

  const receiptPath = [
    'business-projects',
    fixture.enterpriseId,
    fixture.businessProjectId,
    'organizations',
    'ai-brand-officer',
    'tasks',
    fixture.taskId,
    'evidence',
    'knowledge',
    'knowledge_context.json',
  ].join('/');
  const receipt = createKnowledgeContext({
    schemaVersion: 1,
    requestId: fixture.taskId,
    generatedAt: fixture.fixedNow,
    status: 'no_hit',
    taskSummary: 'Validate the brand visual semantic runtime gate.',
    capabilityId: 'brand-visual',
    spaces: [
      { name: '老雷知识库', spaceId: 'space-laolei' },
      { name: '老雷课件知识库', spaceId: 'space-courseware' },
    ],
    queries: ['brand visual'],
    sources: [],
    unreadCandidates: [],
    degradedReason: '',
  });
  const receiptBytes = Buffer.from(JSON.stringify(receipt, null, 2), 'utf8');
  const receiptFile = path.resolve(fixture.projectRoot, receiptPath);
  await fs.mkdir(path.dirname(receiptFile), { recursive: true });
  await fs.writeFile(receiptFile, receiptBytes);

  const registrySha256 = sha256(registryBytes);
  const projectSha256 = sha256(projectBytes);
  let reviewCount = 0;
  const request = {
    taskIdentity: { ...fixture.identity },
    skillId: 'brand-visual',
    goal: '制作单张临时活动海报并探索AI视觉主体',
    requestedModuleIds: [
      'poster-art-direction',
      'ai-visual-generation',
    ],
    availableInputs: {},
    constraints: {},
    conversationFacts: [{
      id: 'visual-direction-confirmed',
      claim: '帝王已确认本次临时海报用途。',
      sourceRef: 'conversation:visual-001',
      confidence: 'confirmed',
    }],
    publicSources: [],
    professionalJudgments: [{
      id: 'visual-judgment',
      category: 'professional-judgment',
      claim: '三个方向必须绑定不同可见资产。',
      sourceRef: 'brand-officer:visual-review',
      confidence: 'supported',
    }],
    criticalUnknowns: [],
  };
  const trustedOptions = {
    projectRoot: fixture.projectRoot,
    projectContext: {
      schemaVersion: 1,
      taskId: fixture.taskId,
      enterpriseId: fixture.enterpriseId,
      businessProjectId: fixture.businessProjectId,
      projectContextVersion: 1,
      readableArtifacts: [],
    },
    receiptBinding: {
      receiptPath,
      receiptSha256: sha256(receiptBytes),
    },
    brandId: 'brand-001',
    visualPolicyContext: {
      schemaVersion: 1,
      projectContextVersion: 1,
      commanderTaskId: fixture.projectRecord.commanderTaskId,
    },
    async executeModules() {
      const directionHashes = duplicateDirections
        ? ['a'.repeat(64), 'a'.repeat(64), 'c'.repeat(64)]
        : ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];
      const publicCapabilityHandoffs = includePublicHandoff
        ? [{
          registryRef: {
            path: 'public-skills/registry.json',
            versionOrHash: `sha256:${registrySha256}`,
            sha256: registrySha256,
            readAt: fixture.fixedNow,
          },
          publicSkillId: 'public.promotional-poster',
          capabilityId: 'promotional-poster',
          maturity: 'operational',
          allowedOrganizations: ['ai-brand-officer'],
          controllerTaskAuthorizationRef: {
            enterpriseId: fixture.enterpriseId,
            businessProjectId: fixture.businessProjectId,
            taskId: fixture.taskId,
            contextVersion: 1,
            projectFileSha256: projectSha256,
            commanderTaskId: fixture.projectRecord.commanderTaskId,
          },
          authorized: true,
          decision: 'allow-formal-execution',
        }]
        : [];
      const withoutHash = {
        candidateId: 'visual-candidate-001',
        taskId: fixture.taskId,
        enterpriseId: fixture.enterpriseId,
        businessProjectId: fixture.businessProjectId,
        skillId: 'brand-visual',
        content: {
          schemaVersion: 1,
          brandId: 'brand-001',
          selectedModuleIds: [
            'poster-art-direction',
            'ai-visual-generation',
          ],
          directionCandidates: directionHashes.map((imageSha256, index) => ({
            directionId: `direction-0${index + 1}`,
            imageSha256,
          })),
          pairwiseDifferenceEvidence: [
            {
              directionIds: ['direction-01', 'direction-02'],
              dimensions: ['composition', 'lighting'],
            },
            {
              directionIds: ['direction-01', 'direction-03'],
              dimensions: ['color', 'typography'],
            },
            {
              directionIds: ['direction-02', 'direction-03'],
              dimensions: ['material', 'whitespace'],
            },
          ],
          aestheticProfileRef: {
            enterpriseId: fixture.enterpriseId,
            businessProjectId: fixture.businessProjectId,
            brandId: 'brand-001',
            artifactId: 'aesthetic-profile',
            version: 1,
            sha256: 'd'.repeat(64),
            importSnapshotRef: null,
          },
          publicCapabilityHandoffs,
        },
      };
      return {
        ...withoutHash,
        candidateHash: stableSha256(withoutHash),
      };
    },
    async reviewCandidate() {
      reviewCount += 1;
      return {
        ruleReview: {
          reviewId: 'visual-rule-review-001',
          reviewerId: RULE_REVIEWER_ID,
          reviewerRole: 'rule-engine',
          passed: true,
          failedCriteria: [],
          hardVetoes: [],
        },
        professionalReview: {
          reviewId: 'visual-professional-review-001',
          reviewerId: PROFESSIONAL_REVIEWER_ID,
          reviewerRole: 'brand-professional-reviewer',
          passed: true,
          score: 91,
          observations: ['三个方向具备不同视觉资产和成对差异证据。'],
          correctionTargets: [],
        },
        affectedModuleIds: [
          'poster-art-direction',
          'ai-visual-generation',
        ],
        requiresBusinessDecision: false,
        blockedReason: '',
        remainingRisks: [],
        requestedBusinessInput: [],
      };
    },
    reviewerBindings: {
      ruleReviewerId: RULE_REVIEWER_ID,
      professionalReviewerId: PROFESSIONAL_REVIEWER_ID,
    },
    now() {
      return new Date(fixture.fixedNow);
    },
  };
  return {
    fixture,
    request,
    trustedOptions,
    get reviewCount() {
      return reviewCount;
    },
  };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function materializeRuntimeCore(runtime) {
  const { request, trustedOptions } = runtime;
  const workspace = await createBrandProjectWorkspace({
    projectRoot: trustedOptions.projectRoot,
    ...request.taskIdentity,
  });
  const plan = buildBrandTaskPlan({
    ...request.taskIdentity,
    skillId: request.skillId,
    goal: request.goal,
    requestedModuleIds: request.requestedModuleIds,
    availableInputs: request.availableInputs,
    constraints: request.constraints,
    upstreamArtifacts: trustedOptions.projectContext.readableArtifacts,
  });
  const evidenceTrustedOptions = {
    projectRoot: trustedOptions.projectRoot,
    projectContext: trustedOptions.projectContext,
    receiptBinding: trustedOptions.receiptBinding,
  };
  const evidenceBundle = await buildBrandEvidenceBundle({
    taskIdentity: request.taskIdentity,
    skillId: request.skillId,
    conversationFacts: request.conversationFacts,
    publicSources: request.publicSources,
    professionalJudgments: request.professionalJudgments,
    requestedUpstreamArtifacts: trustedOptions.projectContext.readableArtifacts,
    criticalUnknowns: request.criticalUnknowns,
  }, evidenceTrustedOptions);
  await Promise.all([
    writeJsonAtomic(workspace.planFile, plan),
    writeJsonAtomic(workspace.evidenceFile, evidenceBundle),
  ]);
  const debugRuntime = createFileBackedBrandDebugRuntime({ workspace });
  let state = await createBrandDebugState({
    taskIdentity: request.taskIdentity,
    skillId: plan.skillId,
    planHash: plan.planHash,
    evidenceHash: evidenceBundle.evidenceHash,
    now: runtime.fixture.fixedNow,
  }, debugRuntime);
  const step = async (event, offset) => {
    state = await advanceBrandDebugState({
      current: state,
      event,
      now: new Date(
        Date.parse(runtime.fixture.fixedNow) + offset * 1000,
      ).toISOString(),
    }, debugRuntime);
  };
  return {
    workspace,
    plan,
    evidenceBundle,
    evidenceTrustedOptions,
    debugRuntime,
    get state() { return state; },
    step,
  };
}

function deterministicCandidate(runtime, index = 1) {
  const withoutHash = {
    candidateId: `candidate-${index}`,
    taskId: runtime.fixture.taskId,
    enterpriseId: runtime.fixture.enterpriseId,
    businessProjectId: runtime.fixture.businessProjectId,
    skillId: 'brand-positioning',
    content: {
      sections: [{
        sectionId: 'positioning-result',
        content: `Candidate round ${index}.`,
      }],
    },
  };
  return { ...withoutHash, candidateHash: stableSha256(withoutHash) };
}

async function persistReviewRecord({
  runtime,
  core,
  candidate,
  rawReview,
}) {
  const persistedContext = await persistCandidateContext({
    runtime,
    core,
    candidate,
  });
  const anchoredCandidate = persistedContext.candidate;
  const normalized = {
    affectedModuleIds: rawReview.affectedModuleIds,
    correction: rawReview.professionalReview.correctionTargets.join(' ')
      || 'No correction is required.',
    requiresBusinessDecision: rawReview.requiresBusinessDecision,
    blockedReason: rawReview.blockedReason,
    remainingRisks: rawReview.remainingRisks,
    requestedBusinessInput: rawReview.requestedBusinessInput,
  };
  const reviewTrustedOptions = {
    plan: core.plan,
    evidenceBundle: core.evidenceBundle,
    evidenceTrustedOptions: core.evidenceTrustedOptions,
    candidate: anchoredCandidate,
    reviewerBindings: runtime.trustedOptions.reviewerBindings,
  };
  const review = await evaluateBrandCandidate({
    ruleReview: rawReview.ruleReview,
    professionalReview: rawReview.professionalReview,
  }, reviewTrustedOptions);
  const {
    deliveryContext,
    executionContextCommitment,
    executionPayload,
  } = persistedContext;
  const deliveryContextCommitment = stableSha256({
    ...executionPayload,
    candidateHash: anchoredCandidate.candidateHash,
    reviewHash: review.reviewHash,
    executionContextCommitment,
  });
  await writeJsonAtomic(
    path.join(core.workspace.reviewsRoot, `${review.reviewHash}.json`),
    {
      schemaVersion: 1,
      review,
      reviewTrustedOptions,
      diagnostic: normalized,
      deliveryContext,
      executionContextCommitment,
      deliveryContextCommitment,
      policyContextHash: null,
    },
  );
  return { review, reviewTrustedOptions };
}

async function persistCandidateContext({
  runtime,
  core,
  candidate,
  deliveryContext: suppliedContext,
}) {
  const deliveryContext = suppliedContext ?? {
    businessConclusion: candidate.content.sections[0].content,
    recommendedCandidate: candidate.candidateId,
    confirmedConclusions: [candidate.content.sections[0].content],
    riskNotes: [],
    decisionRequests: [],
    mustPreserve: [...core.plan.acceptanceCriteria],
    mayAdapt: [],
    forbiddenChanges: [...core.plan.stopConditions],
    nextOrganizationRecommendation: null,
  };
  const taskIdentity = { ...runtime.request.taskIdentity };
  const baseCandidateHash = candidate.candidateHash;
  const executionPayload = {
    deliveryContext,
    baseCandidateHash,
    taskIdentity,
    skillId: core.plan.skillId,
    planHash: core.plan.planHash,
    evidenceHash: core.evidenceBundle.evidenceHash,
  };
  const executionContextCommitment = stableSha256(executionPayload);
  const { candidateHash: ignoredCandidateHash, ...candidateWithoutHash } =
    candidate;
  const anchoredWithoutHash = {
    ...candidateWithoutHash,
    content: {
      ...candidate.content,
      _brandDeliveryContextCommitment: executionContextCommitment,
    },
  };
  const anchoredCandidate = {
    ...anchoredWithoutHash,
    candidateHash: stableSha256(anchoredWithoutHash),
  };
  const contextRecord = JSON.parse(stableStringify({
    schemaVersion: 1,
    candidate: anchoredCandidate,
    ...executionPayload,
    candidateHash: anchoredCandidate.candidateHash,
    executionContextCommitment,
    policyContextHash: null,
  }));
  await writeJsonAtomic(
    path.join(
      core.workspace.candidatesRoot,
      `${candidate.candidateId}.json`,
    ),
    anchoredCandidate,
  );
  await writeJsonAtomic(
    path.join(
      core.workspace.candidatesRoot,
      `${candidate.candidateId}.delivery-context.json`,
    ),
    contextRecord,
  );
  return {
    candidate: anchoredCandidate,
    deliveryContext,
    executionContextCommitment,
    executionPayload,
  };
}

function runNodeChild(source, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '--input-type=module',
      '--eval',
      source,
    ], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`child exited ${code}: ${stderr}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

test('runs one pass, writes every immutable candidate file, and never publishes', async (t) => {
  const runtime = await makeRuntimeCase(t);
  const result = await runBrandSkillRuntime(runtime.request, runtime.trustedOptions);

  assert.equal(result.status, 'returned_to_control_center');
  assert.equal(result.outcome, 'candidate_ready');
  assert.equal(path.isAbsolute(result.deliverablePath), false);
  assert.match(
    result.deliverablePath,
    /^business-projects\/enterprise-001\/20260729-001-brand-runtime\/organizations\/ai-brand-officer\/tasks\/brand-task-001\/deliverables\/candidate-1[.]json$/u,
  );
  assert.equal(result.releaseBoundary, 'organization-candidate-only');
  assert.equal(result.deliverable.systemPackage.policyContextHash, null);
  await assert.rejects(
    fs.access(path.join(
      result.workspace.taskRoot,
      'communication-policy-context.json',
    )),
    { code: 'ENOENT' },
  );
  assert.equal(result.debugState.status, 'returned_to_control_center');
  assert.equal(runtime.counts.execute, 1);
  assert.equal(runtime.counts.review, 1);
  for (const call of [runtime.executeCalls[0], runtime.reviewCalls[0]]) {
    assert.match(call.operation.operationId, /^brand-(execute|review)-[a-f0-9]{32}$/u);
    assert.match(call.operation.idempotencyKey, /^brand-runtime-v1:[a-f0-9]{64}$/u);
    assert.equal(call.operation.deliverySemantics, 'at-least-once');
  }
  assert.notEqual(
    runtime.executeCalls[0].operation.operationId,
    runtime.reviewCalls[0].operation.operationId,
  );
  assert.equal(result.deliverable.sha256, (
    await readJson(path.join(
      result.workspace.deliverablesRoot,
      `${result.candidate.candidateId}.json`,
    ))
  ).sha256);
  assert.equal(
    (await readJson(result.workspace.planFile)).planHash,
    result.plan.planHash,
  );
  assert.equal(
    (await readJson(result.workspace.evidenceFile)).evidenceHash,
    result.evidenceBundle.evidenceHash,
  );
  assert.equal(
    (await readJson(path.join(
      result.workspace.candidatesRoot,
      `${result.candidate.candidateId}.json`,
    ))).candidateHash,
    result.candidate.candidateHash,
  );
  assert.equal(
    (await readJson(path.join(
      result.workspace.reviewsRoot,
      `${result.review.reviewHash}.json`,
    ))).review.reviewHash,
    result.review.reviewHash,
  );
  for (const candidate of Object.values(result.workspace)) {
    assert.equal(candidate.includes(`${path.sep}shared-artifacts${path.sep}`), false);
    assert.equal(candidate.includes(`${path.sep}outputs${path.sep}`), false);
  }
  await assert.rejects(
    fs.access(path.join(runtime.fixture.projectDirectory, 'shared-artifacts')),
  );
});

test('critical evidence blocks before module execution and produces no package', async (t) => {
  const runtime = await makeRuntimeCase(t, {
    criticalUnknowns: [{
      id: 'unknown-audience',
      criticalField: 'primary-audience',
      description: 'The primary audience is not confirmed.',
      sourceRef: 'unknown:owner',
    }],
  });
  const result = await runBrandSkillRuntime(runtime.request, runtime.trustedOptions);

  assert.equal(result.status, 'returned_to_control_center');
  assert.equal(result.outcome, 'blocked');
  assert.equal(result.deliverablePath, null);
  assert.equal(runtime.counts.execute, 0);
  assert.equal(runtime.counts.review, 0);
  assert.equal(result.deliverable, null);
  assert.ok(result.diagnostic.blockedReason.length > 0);
  assert.deepEqual(await fs.readdir(result.workspace.deliverablesRoot), []);
});

test('performs one real correction round and binds the correction into execution', async (t) => {
  const runtime = await makeRuntimeCase(t, {
    reviews: [
      makeReview(1, { pass: false }),
      makeReview(2, { pass: true }),
    ],
  });
  const result = await runBrandSkillRuntime(runtime.request, runtime.trustedOptions);

  assert.equal(result.status, 'returned_to_control_center');
  assert.equal(result.outcome, 'candidate_ready');
  assert.equal(runtime.counts.execute, 2);
  assert.equal(runtime.counts.review, 2);
  assert.equal(runtime.executeCalls[0].previousCandidate, null);
  assert.equal(runtime.executeCalls[0].correction, null);
  assert.equal(
    runtime.executeCalls[1].previousCandidate.candidateId,
    'candidate-1',
  );
  assert.match(
    runtime.executeCalls[1].correction,
    /Narrow the differentiation/u,
  );
  assert.match(runtime.executeCalls[1].roundId, /^round-/u);
  assert.equal(runtime.executeCalls[1].treatmentId, 'local-correction');
  assert.equal(result.debugState.attemptedCorrections.length, 1);
  assert.notEqual(
    runtime.executeCalls[0].previousCandidate?.candidateHash,
    result.candidate.candidateHash,
  );
});

test('stops after three applied correction rounds and never packages', async (t) => {
  const runtime = await makeRuntimeCase(t, {
    reviews: [
      makeReview(1, { pass: false }),
      makeReview(2, { pass: false }),
      makeReview(3, { pass: false }),
      makeReview(4, { pass: false }),
    ],
  });
  const result = await runBrandSkillRuntime(runtime.request, runtime.trustedOptions);

  assert.equal(result.status, 'returned_to_control_center');
  assert.equal(result.outcome, 'blocked');
  assert.equal(runtime.counts.execute, 4);
  assert.equal(runtime.counts.review, 4);
  assert.equal(result.debugState.attemptedCorrections.length, 3);
  assert.equal(result.deliverable, null);
  assert.ok(result.diagnostic.attemptedCorrections.length === 3);
  assert.deepEqual(await fs.readdir(result.workspace.deliverablesRoot), []);
});

test('callback failures are converted to a persisted blocked diagnosis', async (t) => {
  await t.test('module callback', async (t2) => {
    const runtime = await makeRuntimeCase(t2, { throwExecute: true });
    const result = await runBrandSkillRuntime(runtime.request, runtime.trustedOptions);
    assert.equal(result.status, 'returned_to_control_center');
    assert.equal(result.outcome, 'blocked');
    assert.match(
      result.diagnostic.blockedReason,
      /^\[EXECUTE_CALLBACK_FAILED\] module execution failed:/u,
    );
    assert.equal(result.deliverable, null);
    assert.equal((await readJson(result.workspace.debugStateFile)).status,
      'returned_to_control_center');
  });
  await t.test('review callback', async (t2) => {
    const runtime = await makeRuntimeCase(t2, { throwReview: true });
    const result = await runBrandSkillRuntime(runtime.request, runtime.trustedOptions);
    assert.equal(result.status, 'returned_to_control_center');
    assert.equal(result.outcome, 'blocked');
    assert.match(
      result.diagnostic.blockedReason,
      /^\[REVIEW_CALLBACK_FAILED\] review callback failed:/u,
    );
    assert.equal(result.deliverable, null);
  });
  await t.test('structurally returned but Task4-invalid review', async (t2) => {
    const invalid = makeReview(1);
    invalid.ruleReview.reviewerId = 'forged-reviewer';
    const runtime = await makeRuntimeCase(t2, { reviews: [invalid] });
    const result = await runBrandSkillRuntime(runtime.request, runtime.trustedOptions);
    assert.equal(result.status, 'returned_to_control_center');
    assert.equal(result.outcome, 'blocked');
    assert.match(
      result.diagnostic.blockedReason,
      /^\[TASK4_VALIDATION_FAILED\] Task4 review validation.*reviewerId/iu,
    );
    assert.equal(
      (await readJson(result.workspace.debugStateFile)).status,
      'returned_to_control_center',
    );
  });
});

test('a restarted runtime restores the completed task without re-executing callbacks', async (t) => {
  const runtime = await makeRuntimeCase(t);
  const first = await runBrandSkillRuntime(runtime.request, runtime.trustedOptions);
  const executeCount = runtime.counts.execute;
  const reviewCount = runtime.counts.review;
  const second = await runBrandSkillRuntime(runtime.request, runtime.trustedOptions);

  assert.equal(second.status, 'returned_to_control_center');
  assert.equal(second.outcome, 'candidate_ready');
  assert.equal(second.deliverable.sha256, first.deliverable.sha256);
  assert.equal(runtime.counts.execute, executeCount);
  assert.equal(runtime.counts.review, reviewCount);
});

test('concurrent runtimes lease one task and execute/review callbacks exactly once', async (t) => {
  const runtime = await makeRuntimeCase(t);
  const baseExecute = runtime.trustedOptions.executeModules;
  const baseReview = runtime.trustedOptions.reviewCandidate;
  runtime.trustedOptions.executeModules = async (input) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return baseExecute(input);
  };
  runtime.trustedOptions.reviewCandidate = async (input) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return baseReview(input);
  };
  const results = await Promise.all([
    runBrandSkillRuntime(runtime.request, runtime.trustedOptions),
    runBrandSkillRuntime(runtime.request, runtime.trustedOptions),
  ]);
  assert.equal(runtime.counts.execute, 1);
  assert.equal(runtime.counts.review, 1);
  assert.equal(results[0].deliverable.sha256, results[1].deliverable.sha256);
});

test('a live owner is not reclaimed during a callback longer than the stale threshold', async (t) => {
  const runtime = await makeRuntimeCase(t);
  const baseExecute = runtime.trustedOptions.executeModules;
  runtime.trustedOptions.executeModules = async (input) => {
    await new Promise((resolve) => setTimeout(resolve, 2_600));
    return baseExecute(input);
  };
  const first = runBrandSkillRuntime(runtime.request, runtime.trustedOptions);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const second = runBrandSkillRuntime(runtime.request, runtime.trustedOptions);
  const results = await Promise.all([first, second]);
  assert.equal(runtime.counts.execute, 1);
  assert.equal(runtime.counts.review, 1);
  assert.equal(results[0].deliverable.sha256, results[1].deliverable.sha256);
});

test('crash after callback retries the same operation id and external effect remains once', async (t) => {
  const runtime = await makeRuntimeCase(t);
  const baseExecute = runtime.trustedOptions.executeModules;
  const effects = new Map();
  runtime.trustedOptions.executeModules = async (input) => {
    const operationId = input.operation.operationId;
    if (!effects.has(operationId)) {
      effects.set(operationId, await baseExecute(input));
    }
    return structuredClone(effects.get(operationId));
  };
  let crashed = false;
  runtime.trustedOptions.operationFaultInjector = async ({ stage }) => {
    if (!crashed && stage === 'execute') {
      crashed = true;
      throw new Error('simulated process crash after callback');
    }
  };
  await assert.rejects(
    runBrandSkillRuntime(runtime.request, runtime.trustedOptions),
    /simulated process crash/iu,
  );
  runtime.trustedOptions.operationFaultInjector = async () => {};
  const recovered = await runBrandSkillRuntime(
    runtime.request,
    runtime.trustedOptions,
  );
  assert.equal(recovered.outcome, 'candidate_ready');
  assert.equal(effects.size, 1);
  assert.equal(runtime.counts.execute, 1);
  const operationFiles = await fs.readdir(
    path.join(recovered.workspace.taskRoot, 'operations'),
  );
  assert.ok(operationFiles.some((name) => name.endsWith('.intent.json')));
  assert.ok(operationFiles.some((name) => name.endsWith('.completion.json')));
});

test('an operation journal conflict is captured with an immutable-write stage code', async (t) => {
  const runtime = await makeRuntimeCase(t);
  let crashed = false;
  runtime.trustedOptions.operationFaultInjector = async ({ stage }) => {
    if (!crashed && stage === 'execute') {
      crashed = true;
      throw new Error('stop after intent and callback');
    }
  };
  await assert.rejects(
    runBrandSkillRuntime(runtime.request, runtime.trustedOptions),
    /stop after intent and callback/iu,
  );
  const workspace = await createBrandProjectWorkspace({
    projectRoot: runtime.fixture.projectRoot,
    ...runtime.request.taskIdentity,
  });
  const operationsRoot = path.join(workspace.taskRoot, 'operations');
  const intentName = (await fs.readdir(operationsRoot)).find(
    (name) => name.endsWith('.intent.json'),
  );
  const intentPath = path.join(operationsRoot, intentName);
  const intent = await readJson(intentPath);
  await fs.writeFile(intentPath, `${JSON.stringify({
    ...intent,
    binding: {
      ...intent.binding,
      stage: 'tampered-stage',
    },
  }, null, 2)}\n`);
  runtime.trustedOptions.operationFaultInjector = async () => {};
  const result = await runBrandSkillRuntime(
    runtime.request,
    runtime.trustedOptions,
  );
  assert.equal(result.outcome, 'blocked');
  assert.match(
    result.diagnostic.blockedReason,
    /^\[IMMUTABLE_WRITE_FAILED\] module execution journal failed:/u,
  );
  assert.equal(runtime.counts.execute, 1);
});

test('task execution lease recovers a stale and future-dated dead owner', async (t) => {
  for (const createdAt of [
    '2000-01-01T00:00:00.000Z',
    '2999-01-01T00:00:00.000Z',
  ]) {
    await t.test(createdAt.startsWith('2999') ? 'future' : 'stale', async (t2) => {
      const runtime = await makeRuntimeCase(t2);
      const workspace = await createBrandProjectWorkspace({
        projectRoot: runtime.fixture.projectRoot,
        ...runtime.request.taskIdentity,
      });
      await fs.writeFile(
        path.join(workspace.taskRoot, 'runtime-execution.lease.json'),
        JSON.stringify({
          token: 'dead-owner',
          pid: 2_147_483_647,
          createdAt,
          heartbeatAt: createdAt,
        }),
      );
      const result = await runBrandSkillRuntime(
        runtime.request,
        runtime.trustedOptions,
      );
      assert.equal(result.outcome, 'candidate_ready');
      await assert.rejects(
        fs.access(path.join(workspace.taskRoot, 'runtime-execution.lease.json')),
      );
    });
  }
});

test('resumes every in-progress state from persisted boundaries without replaying successful work', async (t) => {
  const setLateClock = (runtime) => {
    let tick = 100;
    runtime.trustedOptions.now = () => new Date(
      Date.parse(runtime.fixture.fixedNow) + tick++ * 1000,
    );
  };

  await t.test('planning continues with both callbacks once', async (t2) => {
    const runtime = await makeRuntimeCase(t2);
    const core = await materializeRuntimeCore(runtime);
    await core.step({ type: 'start-planning' }, 1);
    setLateClock(runtime);
    const result = await runBrandSkillRuntime(runtime.request, runtime.trustedOptions);
    assert.equal(result.outcome, 'candidate_ready');
    assert.equal(runtime.counts.execute, 1);
    assert.equal(runtime.counts.review, 1);
  });

  await t.test('collecting evidence continues with both callbacks once', async (t2) => {
    const runtime = await makeRuntimeCase(t2);
    const core = await materializeRuntimeCore(runtime);
    await core.step({ type: 'start-planning' }, 1);
    await core.step({ type: 'plan-ready' }, 2);
    setLateClock(runtime);
    const result = await runBrandSkillRuntime(runtime.request, runtime.trustedOptions);
    assert.equal(result.outcome, 'candidate_ready');
    assert.equal(runtime.counts.execute, 1);
    assert.equal(runtime.counts.review, 1);
  });

  await t.test('executing reuses an immutable candidate output', async (t2) => {
    const runtime = await makeRuntimeCase(t2);
    const core = await materializeRuntimeCore(runtime);
    await core.step({ type: 'start-planning' }, 1);
    await core.step({ type: 'plan-ready' }, 2);
    await core.step({ type: 'evidence-ready' }, 3);
    const candidate = deterministicCandidate(runtime);
    await writeJsonAtomic(
      path.join(core.workspace.candidatesRoot, `${candidate.candidateId}.json`),
      candidate,
    );
    const persistedCandidate = await persistCandidateContext({
      runtime,
      core,
      candidate,
    });
    setLateClock(runtime);
    const result = await runBrandSkillRuntime(runtime.request, runtime.trustedOptions);
    assert.equal(result.outcome, 'candidate_ready');
    assert.equal(runtime.counts.execute, 0);
    assert.equal(runtime.counts.review, 1);
    assert.equal(
      result.candidate.candidateHash,
      persistedCandidate.candidate.candidateHash,
    );
  });

  await t.test('reviewing reuses an immutable validated review output', async (t2) => {
    const runtime = await makeRuntimeCase(t2);
    const core = await materializeRuntimeCore(runtime);
    await core.step({ type: 'start-planning' }, 1);
    await core.step({ type: 'plan-ready' }, 2);
    await core.step({ type: 'evidence-ready' }, 3);
    const candidate = deterministicCandidate(runtime);
    await writeJsonAtomic(
      path.join(core.workspace.candidatesRoot, `${candidate.candidateId}.json`),
      candidate,
    );
    await core.step({ type: 'execution-ready' }, 4);
    await core.step({ type: 'review-started' }, 5);
    await persistReviewRecord({
      runtime,
      core,
      candidate,
      rawReview: makeReview(1),
    });
    setLateClock(runtime);
    const result = await runBrandSkillRuntime(runtime.request, runtime.trustedOptions);
    assert.equal(result.outcome, 'candidate_ready');
    assert.equal(runtime.counts.execute, 0);
    assert.equal(runtime.counts.review, 0);
  });

  await t.test('reworking reuses an immutable corrected candidate output', async (t2) => {
    const runtime = await makeRuntimeCase(t2, {
      reviews: [makeReview(2)],
    });
    const core = await materializeRuntimeCore(runtime);
    await core.step({ type: 'start-planning' }, 1);
    await core.step({ type: 'plan-ready' }, 2);
    await core.step({ type: 'evidence-ready' }, 3);
    const first = deterministicCandidate(runtime, 1);
    await writeJsonAtomic(
      path.join(core.workspace.candidatesRoot, `${first.candidateId}.json`),
      first,
    );
    await core.step({ type: 'execution-ready' }, 4);
    await core.step({ type: 'review-started' }, 5);
    const failed = await persistReviewRecord({
      runtime,
      core,
      candidate: first,
      rawReview: makeReview(1, { pass: false }),
    });
    await core.step({
      type: 'review-failed',
      reviewHash: failed.review.reviewHash,
    }, 6);
    const corrected = deterministicCandidate(runtime, 2);
    await writeJsonAtomic(
      path.join(core.workspace.candidatesRoot, `${corrected.candidateId}.json`),
      corrected,
    );
    const persistedCorrected = await persistCandidateContext({
      runtime,
      core,
      candidate: corrected,
    });
    setLateClock(runtime);
    const result = await runBrandSkillRuntime(runtime.request, runtime.trustedOptions);
    assert.equal(result.outcome, 'candidate_ready');
    assert.equal(runtime.counts.execute, 0);
    assert.equal(runtime.counts.review, 1);
    assert.equal(
      result.candidate.candidateHash,
      persistedCorrected.candidate.candidateHash,
    );
  });
});

test('execution delivery context survives an executing-state restart byte-for-byte', async (t) => {
  const completedRuntime = await makeRuntimeCase(t);
  const baseExecute = completedRuntime.trustedOptions.executeModules;
  completedRuntime.trustedOptions.executeModules = async (input) => {
    const candidate = await baseExecute(input);
    return {
      candidate,
      deliveryContext: makeDeliveryContext(candidate.candidateId),
    };
  };
  const completed = await runBrandSkillRuntime(
    completedRuntime.request,
    completedRuntime.trustedOptions,
  );
  const contextName = `${completed.candidate.candidateId}.delivery-context.json`;
  const contextPath = path.join(completed.workspace.candidatesRoot, contextName);
  const persistedContext = await readJson(contextPath);
  assert.equal(
    completed.candidate.content._brandDeliveryContextCommitment,
    persistedContext.executionContextCommitment,
  );
  assert.match(
    persistedContext.executionContextCommitment,
    /^[a-f0-9]{64}$/u,
  );

  const restartedRuntime = await makeRuntimeCase(t);
  const core = await materializeRuntimeCore(restartedRuntime);
  await core.step({ type: 'start-planning' }, 1);
  await core.step({ type: 'plan-ready' }, 2);
  await core.step({ type: 'evidence-ready' }, 3);
  await Promise.all([
    fs.copyFile(
      path.join(
        completed.workspace.candidatesRoot,
        `${completed.candidate.candidateId}.json`,
      ),
      path.join(
        core.workspace.candidatesRoot,
        `${completed.candidate.candidateId}.json`,
      ),
    ),
    fs.copyFile(
      contextPath,
      path.join(core.workspace.candidatesRoot, contextName),
    ),
  ]);
  let tick = 100;
  restartedRuntime.trustedOptions.now = () => new Date(
    Date.parse(restartedRuntime.fixture.fixedNow) + tick++ * 1000,
  );
  const restarted = await runBrandSkillRuntime(
    restartedRuntime.request,
    restartedRuntime.trustedOptions,
  );
  assert.equal(restartedRuntime.counts.execute, 0);
  assert.equal(
    stableStringify(restarted.deliverable.humanSummary),
    stableStringify(completed.deliverable.humanSummary),
  );
  assert.equal(
    stableStringify(restarted.deliverable.systemPackage.businessContent),
    stableStringify(completed.deliverable.systemPackage.businessContent),
  );
  assert.equal(
    restarted.deliverable.systemPackage.deliveryContextCommitment,
    completed.deliverable.systemPackage.deliveryContextCommitment,
  );
});

test('module callback cannot preoccupy the reserved delivery commitment field', async (t) => {
  const runtime = await makeRuntimeCase(t);
  const baseExecute = runtime.trustedOptions.executeModules;
  runtime.trustedOptions.executeModules = async (input) => {
    const candidate = await baseExecute(input);
    const withoutHash = {
      ...candidate,
      content: {
        ...candidate.content,
        _brandDeliveryContextCommitment: 'a'.repeat(64),
      },
    };
    delete withoutHash.candidateHash;
    return {
      ...withoutHash,
      candidateHash: stableSha256(withoutHash),
    };
  };
  const result = await runBrandSkillRuntime(
    runtime.request,
    runtime.trustedOptions,
  );
  assert.equal(result.outcome, 'blocked');
  assert.match(
    result.diagnostic.blockedReason,
    /reserved delivery context commitment field/iu,
  );
  assert.deepEqual(await fs.readdir(result.workspace.candidatesRoot), []);
});

test('terminal recovery replays full trusted package bindings after a recomputed hash', async (t) => {
  const mutations = [
    ['task identity', (value) => {
      value.systemPackage.taskIdentity.taskId = 'other-task';
    }],
    ['evidence', (value) => {
      value.systemPackage.evidenceHash = 'e'.repeat(64);
    }],
    ['review', (value) => {
      value.systemPackage.reviewHash = 'f'.repeat(64);
    }],
    ['debug state', (value) => {
      value.systemPackage.debugStateHash = 'd'.repeat(64);
    }],
  ];
  for (const [label, mutate] of mutations) {
    await t.test(label, async (t2) => {
      const runtime = await makeRuntimeCase(t2);
      const completed = await runBrandSkillRuntime(
        runtime.request,
        runtime.trustedOptions,
      );
      const absolute = path.resolve(
        runtime.fixture.projectRoot,
        ...completed.deliverablePath.split('/'),
      );
      const forged = await readJson(absolute);
      mutate(forged);
      forged.sha256 = stableSha256({
        humanSummary: forged.humanSummary,
        systemPackage: forged.systemPackage,
      });
      await writeJsonAtomic(absolute, forged);
      await assert.rejects(
        runBrandSkillRuntime(runtime.request, runtime.trustedOptions),
        /deliverable|package|binding|identity|evidence|review|debug/iu,
      );
    });
  }
});

test('terminal recovery rejects paired delivery-context and package tampering', async (t) => {
  const runtime = await makeRuntimeCase(t);
  const completed = await runBrandSkillRuntime(
    runtime.request,
    runtime.trustedOptions,
  );
  const reviewPath = path.join(
    completed.workspace.reviewsRoot,
    `${completed.review.reviewHash}.json`,
  );
  const record = await readJson(reviewPath);
  record.deliveryContext.businessConclusion = '伪造的配对业务结论。';
  record.deliveryContext.confirmedConclusions = ['伪造的配对业务结论。'];
  record.deliveryContextCommitment = stableSha256({
    deliveryContext: record.deliveryContext,
    baseCandidateHash: completed.deliverable.systemPackage.baseCandidateHash,
    candidateHash: record.review.candidateHash,
    reviewHash: record.review.reviewHash,
    taskIdentity: record.review.taskIdentity,
    skillId: record.review.skillId,
    planHash: record.review.planHash,
    evidenceHash: record.review.evidenceHash,
    executionContextCommitment: record.executionContextCommitment,
  });
  await writeJsonAtomic(reviewPath, record);

  const deliverablePath = path.resolve(
    runtime.fixture.projectRoot,
    ...completed.deliverablePath.split('/'),
  );
  const forged = await readJson(deliverablePath);
  forged.humanSummary.conclusion = '候选方案已通过审核：伪造的配对业务结论。';
  forged.systemPackage.businessContent.businessConclusion =
    '伪造的配对业务结论。';
  forged.systemPackage.businessContent.confirmedConclusions =
    ['伪造的配对业务结论。'];
  forged.systemPackage.deliveryContextCommitment =
    record.deliveryContextCommitment;
  forged.sha256 = stableSha256({
    humanSummary: forged.humanSummary,
    systemPackage: forged.systemPackage,
  });
  await writeJsonAtomic(deliverablePath, forged);

  await assert.rejects(
    runBrandSkillRuntime(runtime.request, runtime.trustedOptions),
    /delivery context|commitment|trusted persisted context/iu,
  );
});

test('candidate hash anchor rejects fully rehashed sidecar, review, and package semantics', async (t) => {
  const runtime = await makeRuntimeCase(t);
  const completed = await runBrandSkillRuntime(
    runtime.request,
    runtime.trustedOptions,
  );
  const contextPath = path.join(
    completed.workspace.candidatesRoot,
    `${completed.candidate.candidateId}.delivery-context.json`,
  );
  const contextRecord = await readJson(contextPath);
  const forgedContext = {
    ...contextRecord.deliveryContext,
    businessConclusion: '全链重算后的伪造业务结论。',
    confirmedConclusions: ['全链重算后的伪造业务结论。'],
  };
  const executionPayload = {
    deliveryContext: forgedContext,
    baseCandidateHash: contextRecord.baseCandidateHash,
    taskIdentity: contextRecord.taskIdentity,
    skillId: contextRecord.skillId,
    planHash: contextRecord.planHash,
    evidenceHash: contextRecord.evidenceHash,
  };
  const forgedExecutionCommitment = stableSha256(executionPayload);
  contextRecord.deliveryContext = forgedContext;
  contextRecord.executionContextCommitment = forgedExecutionCommitment;
  contextRecord.candidate.content._brandDeliveryContextCommitment =
    forgedExecutionCommitment;
  const withoutCandidateHash = { ...contextRecord.candidate };
  delete withoutCandidateHash.candidateHash;
  contextRecord.candidate.candidateHash = stableSha256(withoutCandidateHash);
  contextRecord.candidateHash = contextRecord.candidate.candidateHash;
  await fs.writeFile(
    contextPath,
    `${JSON.stringify(
      JSON.parse(stableStringify(contextRecord)),
      null,
      2,
    )}\n`,
    'utf8',
  );

  const reviewPath = path.join(
    completed.workspace.reviewsRoot,
    `${completed.review.reviewHash}.json`,
  );
  const reviewRecord = await readJson(reviewPath);
  reviewRecord.deliveryContext = forgedContext;
  reviewRecord.executionContextCommitment = forgedExecutionCommitment;
  reviewRecord.deliveryContextCommitment = stableSha256({
    deliveryContext: forgedContext,
    baseCandidateHash: contextRecord.baseCandidateHash,
    candidateHash: contextRecord.candidateHash,
    reviewHash: reviewRecord.review.reviewHash,
    taskIdentity: reviewRecord.review.taskIdentity,
    skillId: reviewRecord.review.skillId,
    planHash: reviewRecord.review.planHash,
    evidenceHash: reviewRecord.review.evidenceHash,
    executionContextCommitment: forgedExecutionCommitment,
  });
  await writeJsonAtomic(reviewPath, reviewRecord);

  const deliverablePath = path.resolve(
    runtime.fixture.projectRoot,
    ...completed.deliverablePath.split('/'),
  );
  const forgedPackage = await readJson(deliverablePath);
  forgedPackage.humanSummary.conclusion =
    '候选方案已通过审核：全链重算后的伪造业务结论。';
  forgedPackage.systemPackage.businessContent.businessConclusion =
    forgedContext.businessConclusion;
  forgedPackage.systemPackage.businessContent.confirmedConclusions =
    forgedContext.confirmedConclusions;
  forgedPackage.systemPackage.baseCandidateHash =
    contextRecord.baseCandidateHash;
  forgedPackage.systemPackage.executionContextCommitment =
    forgedExecutionCommitment;
  forgedPackage.systemPackage.candidateHash = contextRecord.candidateHash;
  forgedPackage.systemPackage.output.candidateHash =
    contextRecord.candidateHash;
  forgedPackage.systemPackage.output.contentJson = stableStringify(
    contextRecord.candidate.content,
  );
  forgedPackage.systemPackage.output.contentSha256 = stableSha256(
    contextRecord.candidate.content,
  );
  forgedPackage.systemPackage.deliveryContextCommitment = stableSha256({
    deliveryContext: forgedContext,
    baseCandidateHash: contextRecord.baseCandidateHash,
    candidateHash: contextRecord.candidateHash,
    reviewHash: forgedPackage.systemPackage.reviewHash,
    taskIdentity: forgedPackage.systemPackage.taskIdentity,
    skillId: forgedPackage.systemPackage.skillId,
    planHash: forgedPackage.systemPackage.planHash,
    evidenceHash: forgedPackage.systemPackage.evidenceHash,
    executionContextCommitment: forgedExecutionCommitment,
  });
  forgedPackage.sha256 = stableSha256({
    humanSummary: forgedPackage.humanSummary,
    systemPackage: forgedPackage.systemPackage,
  });
  await writeJsonAtomic(deliverablePath, forgedPackage);

  await assert.rejects(
    runBrandSkillRuntime(runtime.request, runtime.trustedOptions),
    /candidate.*anchor|candidate.*conflict|review.*binding|debug.*binding/iu,
  );
});

test('new review records cannot downgrade by deleting a commitment field', async (t) => {
  const runtime = await makeRuntimeCase(t);
  const completed = await runBrandSkillRuntime(
    runtime.request,
    runtime.trustedOptions,
  );
  const reviewPath = path.join(
    completed.workspace.reviewsRoot,
    `${completed.review.reviewHash}.json`,
  );
  const record = await readJson(reviewPath);
  delete record.deliveryContextCommitment;
  await writeJsonAtomic(reviewPath, record);
  await assert.rejects(
    runBrandSkillRuntime(runtime.request, runtime.trustedOptions),
    /missing field: deliveryContextCommitment|commitment fields/iu,
  );
});

test('delivery context sidecar enforces canonical bytes, size, and no-link reads', async (t) => {
  const prepare = async (t2) => {
    const runtime = await makeRuntimeCase(t2);
    const completed = await runBrandSkillRuntime(
      runtime.request,
      runtime.trustedOptions,
    );
    return {
      runtime,
      contextPath: path.join(
        completed.workspace.candidatesRoot,
        `${completed.candidate.candidateId}.delivery-context.json`,
      ),
    };
  };

  await t.test('non-canonical bytes', async (t2) => {
    const { runtime, contextPath } = await prepare(t2);
    const parsed = await readJson(contextPath);
    await fs.writeFile(contextPath, JSON.stringify(parsed), 'utf8');
    await assert.rejects(
      runBrandSkillRuntime(runtime.request, runtime.trustedOptions),
      /context record bytes are not canonical/iu,
    );
  });

  await t.test('actual UTF-8 byte budget', async (t2) => {
    const { runtime, contextPath } = await prepare(t2);
    const original = await fs.readFile(contextPath);
    await fs.writeFile(
      contextPath,
      Buffer.concat([original, Buffer.alloc(1024 * 1024, 0x20)]),
    );
    await assert.rejects(
      runBrandSkillRuntime(runtime.request, runtime.trustedOptions),
      /context record exceeds the 1 MiB byte budget/iu,
    );
  });

  await t.test('symbolic link substitution', async (t2) => {
    const { runtime, contextPath } = await prepare(t2);
    const outside = path.join(runtime.fixture.projectRoot, 'outside-context.json');
    await fs.copyFile(contextPath, outside);
    await fs.unlink(contextPath);
    try {
      await fs.symlink(outside, contextPath, 'file');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
        t2.skip(`file symlink unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    await assert.rejects(
      runBrandSkillRuntime(runtime.request, runtime.trustedOptions),
      /delivery context record.*regular file|symbolic link/iu,
    );
    assert.equal((await fs.lstat(contextPath)).isSymbolicLink(), true);
  });
});

test('resource budgets reject deep, oversized-array, and excessive-directory inputs without changing state', async (t) => {
  await t.test('deep and oversized-array request snapshots', async (t2) => {
    const runtime = await makeRuntimeCase(t2);
    const core = await materializeRuntimeCore(runtime);
    const before = await fs.readFile(core.workspace.debugStateFile);
    let deep = { value: 'leaf' };
    for (let index = 0; index < 70; index += 1) deep = { child: deep };
    await assert.rejects(
      runBrandSkillRuntime({
        ...runtime.request,
        availableInputs: deep,
      }, runtime.trustedOptions),
      /depth budget/iu,
    );
    await assert.rejects(
      runBrandSkillRuntime({
        ...runtime.request,
        availableInputs: {
          oversized: Array.from({ length: 10_001 }, () => 'x'),
        },
      }, runtime.trustedOptions),
      /array budget/iu,
    );
    await assert.rejects(
      runBrandSkillRuntime({
        ...runtime.request,
        availableInputs: {
          oversizedText: 'x'.repeat(4 * 1024 * 1024 + 1),
        },
      }, runtime.trustedOptions),
      /UTF-8 byte budget/iu,
    );
    assert.deepEqual(await fs.readFile(core.workspace.debugStateFile), before);
  });

  await t.test('persisted JSON byte budget', async (t2) => {
    const runtime = await makeRuntimeCase(t2);
    const core = await materializeRuntimeCore(runtime);
    await core.step({ type: 'start-planning' }, 1);
    await core.step({ type: 'plan-ready' }, 2);
    await core.step({ type: 'evidence-ready' }, 3);
    const before = await fs.readFile(core.workspace.debugStateFile);
    await fs.writeFile(
      path.join(core.workspace.candidatesRoot, 'oversized.json'),
      `{"blob":"${'x'.repeat(4 * 1024 * 1024)}"}`,
    );
    await assert.rejects(
      runBrandSkillRuntime(runtime.request, runtime.trustedOptions),
      /candidate file exceeds the JSON byte budget/iu,
    );
    assert.deepEqual(await fs.readFile(core.workspace.debugStateFile), before);
    assert.equal(runtime.counts.execute, 0);
  });

  await t.test('candidate directory file-count budget', async (t2) => {
    const runtime = await makeRuntimeCase(t2);
    const core = await materializeRuntimeCore(runtime);
    await core.step({ type: 'start-planning' }, 1);
    await core.step({ type: 'plan-ready' }, 2);
    await core.step({ type: 'evidence-ready' }, 3);
    const before = await fs.readFile(core.workspace.debugStateFile);
    await Promise.all(Array.from({ length: 1001 }, (_, index) => (
      fs.writeFile(
        path.join(
          core.workspace.candidatesRoot,
          `junk-${String(index).padStart(4, '0')}.json`,
        ),
        '{}',
      )
    )));
    await assert.rejects(
      runBrandSkillRuntime(runtime.request, runtime.trustedOptions),
      /candidate directory.*file-count budget/iu,
    );
    assert.deepEqual(await fs.readFile(core.workspace.debugStateFile), before);
    assert.equal(runtime.counts.execute, 0);
  });

  await t.test('review directory file-count budget', async (t2) => {
    const runtime = await makeRuntimeCase(t2);
    const core = await materializeRuntimeCore(runtime);
    await core.step({ type: 'start-planning' }, 1);
    await core.step({ type: 'plan-ready' }, 2);
    await core.step({ type: 'evidence-ready' }, 3);
    await persistCandidateContext({
      runtime,
      core,
      candidate: deterministicCandidate(runtime),
    });
    await core.step({ type: 'execution-ready' }, 4);
    await core.step({ type: 'review-started' }, 5);
    const before = await fs.readFile(core.workspace.debugStateFile);
    await Promise.all(Array.from({ length: 1001 }, (_, index) => (
      fs.writeFile(
        path.join(
          core.workspace.reviewsRoot,
          `${String(index).padStart(64, '0')}.json`,
        ),
        '{}',
      )
    )));
    await assert.rejects(
      runBrandSkillRuntime(runtime.request, runtime.trustedOptions),
      /review directory.*file-count budget/iu,
    );
    assert.deepEqual(await fs.readFile(core.workspace.debugStateFile), before);
    assert.equal(runtime.counts.review, 0);
  });
});

test('file-backed debug storage provides CAS, restart recovery, and atomic failure safety', async (t) => {
  const fixture = await makeBrandRuntimeFixture(t);
  const workspace = await createBrandProjectWorkspace({
    projectRoot: fixture.projectRoot,
    ...fixture.identity,
  });
  const store = createFileBackedBrandDebugRuntime({ workspace });
  const initial = await createBrandDebugState({
    taskIdentity: { ...fixture.identity },
    skillId: 'brand-positioning',
    planHash: 'a'.repeat(64),
    evidenceHash: 'b'.repeat(64),
    now: fixture.fixedNow,
  }, store);
  const concurrent = await Promise.allSettled([
    advanceBrandDebugState({
      current: initial,
      event: { type: 'start-planning', note: 'first writer' },
      now: '2026-07-29T00:00:01.000Z',
    }, store),
    advanceBrandDebugState({
      current: initial,
      event: { type: 'start-planning', note: 'second writer' },
      now: '2026-07-29T00:00:01.000Z',
    }, store),
  ]);
  assert.equal(concurrent.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(concurrent.filter((item) => item.status === 'rejected').length, 1);
  const restarted = createFileBackedBrandDebugRuntime({ workspace });
  const recovered = await restarted.readDebugState({ ...fixture.identity });
  assert.equal(recovered.revision, 1);
  assert.equal(recovered.status, 'planning');

  const failureFixture = await makeBrandRuntimeFixture(t);
  const failureWorkspace = await createBrandProjectWorkspace({
    projectRoot: failureFixture.projectRoot,
    ...failureFixture.identity,
  });
  let writes = 0;
  const failingStore = createFileBackedBrandDebugRuntime({
    workspace: failureWorkspace,
    atomicWrite: async (...args) => {
      writes += 1;
      if (writes > 1) throw new Error('simulated atomic write failure');
      return writeJsonAtomic(...args);
    },
  });
  const failureInitial = await createBrandDebugState({
    taskIdentity: { ...failureFixture.identity },
    skillId: 'brand-positioning',
    planHash: 'c'.repeat(64),
    evidenceHash: 'd'.repeat(64),
    now: failureFixture.fixedNow,
  }, failingStore);
  await assert.rejects(
    advanceBrandDebugState({
      current: failureInitial,
      event: { type: 'start-planning' },
      now: '2026-07-29T00:00:01.000Z',
    }, failingStore),
    /simulated atomic write failure/u,
  );
  const intact = await createFileBackedBrandDebugRuntime({
    workspace: failureWorkspace,
  }).readDebugState({ ...failureFixture.identity });
  assert.equal(stableStringify(intact), stableStringify(failureInitial));
});

test('debug CAS atomically serializes two real-process stale-lock recoverers', async (t) => {
  const fixture = await makeBrandRuntimeFixture(t);
  const workspace = await createBrandProjectWorkspace({
    projectRoot: fixture.projectRoot,
    ...fixture.identity,
  });
  const store = createFileBackedBrandDebugRuntime({ workspace });
  const initial = await createBrandDebugState({
    taskIdentity: { ...fixture.identity },
    skillId: 'brand-positioning',
    planHash: 'a'.repeat(64),
    evidenceHash: 'b'.repeat(64),
    now: fixture.fixedNow,
  }, store);
  const makeNext = async (note) => {
    let head = structuredClone(initial);
    const memory = {
      async resolveReview() { throw new Error('unused'); },
      async initializeDebugState() { return false; },
      async readDebugState() { return structuredClone(head); },
      async commitDebugState({ nextState }) {
        head = structuredClone(nextState);
        return true;
      },
    };
    return advanceBrandDebugState({
      current: initial,
      event: { type: 'start-planning', note },
      now: '2026-07-29T00:00:01.000Z',
    }, memory);
  };
  const firstNext = await makeNext('process one');
  const secondNext = await makeNext('process two');
  const workspaceFile = path.join(fixture.projectRoot, 'workspace.json');
  const firstFile = path.join(fixture.projectRoot, 'next-one.json');
  const secondFile = path.join(fixture.projectRoot, 'next-two.json');
  await Promise.all([
    writeJsonAtomic(workspaceFile, workspace),
    writeJsonAtomic(firstFile, firstNext),
    writeJsonAtomic(secondFile, secondNext),
  ]);
  const runtimeUrl = pathToFileURL(path.resolve(
    'organizations/ai-brand-officer/scripts/brand_skill_runtime.mjs',
  )).href;
  const atomicUrl = pathToFileURL(path.resolve(
    'scripts/feishu-commander/atomic_store.mjs',
  )).href;
  const childSource = `
    import { readFile } from 'node:fs/promises';
    const { createFileBackedBrandDebugRuntime } = await import(process.env.RUNTIME_URL);
    const { writeJsonAtomic } = await import(process.env.ATOMIC_URL);
    const workspace = JSON.parse(await readFile(process.env.WORKSPACE_FILE, 'utf8'));
    const nextState = JSON.parse(await readFile(process.env.NEXT_FILE, 'utf8'));
    const store = createFileBackedBrandDebugRuntime({
      workspace,
      atomicWrite: async (...args) => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return writeJsonAtomic(...args);
      },
    });
    const result = await store.commitDebugState({
      taskIdentity: nextState.taskIdentity,
      expectedRevision: 0,
      expectedStateHash: process.env.EXPECTED_HASH,
      nextState,
    });
    process.stdout.write(JSON.stringify(result));
  `;
  const common = {
    RUNTIME_URL: runtimeUrl,
    ATOMIC_URL: atomicUrl,
    WORKSPACE_FILE: workspaceFile,
    EXPECTED_HASH: initial.stateHash,
  };
  await fs.writeFile(`${workspace.debugStateFile}.lock`, JSON.stringify({
    token: 'dead-owner-before-two-recoverers',
    pid: 2_147_483_647,
    createdAt: '2000-01-01T00:00:00.000Z',
  }));
  await fs.writeFile(
    `${workspace.debugStateFile}.lock.recovery`,
    JSON.stringify({
      token: 'dead-guard-before-two-recoverers',
      pid: 2_147_483_647,
      createdAt: '2000-01-01T00:00:00.000Z',
    }),
  );
  const results = await Promise.all([
    runNodeChild(childSource, { ...common, NEXT_FILE: firstFile }),
    runNodeChild(childSource, { ...common, NEXT_FILE: secondFile }),
  ]);
  assert.deepEqual(results.sort(), ['false', 'true']);
  const recovered = await store.readDebugState({ ...fixture.identity });
  assert.equal(recovered.revision, 1);
  assert.ok(['process one', 'process two'].includes(recovered.timeline[0].note));
  assert.deepEqual(
    (await fs.readdir(workspace.taskRoot)).filter(
      (name) => name.includes('.lock'),
    ),
    [],
  );
});

test('debug CAS recovers a dead stale owner lock without leaving quarantine files', async (t) => {
  const fixture = await makeBrandRuntimeFixture(t);
  const workspace = await createBrandProjectWorkspace({
    projectRoot: fixture.projectRoot,
    ...fixture.identity,
  });
  const store = createFileBackedBrandDebugRuntime({ workspace });
  const initial = await createBrandDebugState({
    taskIdentity: { ...fixture.identity },
    skillId: 'brand-positioning',
    planHash: 'a'.repeat(64),
    evidenceHash: 'b'.repeat(64),
    now: fixture.fixedNow,
  }, store);
  const lockPath = `${workspace.debugStateFile}.lock`;
  await fs.writeFile(lockPath, JSON.stringify({
    token: 'abandoned-owner',
    pid: 2_147_483_647,
    createdAt: '2000-01-01T00:00:00.000Z',
  }));
  await fs.writeFile(`${lockPath}.recovery`, JSON.stringify({
    token: 'abandoned-recovery-owner',
    pid: 2_147_483_647,
    createdAt: '2000-01-01T00:00:00.000Z',
  }));
  const next = await advanceBrandDebugState({
    current: initial,
    event: { type: 'start-planning', note: 'stale lock recovered' },
    now: '2026-07-29T00:00:01.000Z',
  }, store);
  assert.equal(next.revision, 1);
  assert.equal(next.timeline[0].note, 'stale lock recovered');
  assert.deepEqual(
    (await fs.readdir(workspace.taskRoot)).filter(
      (name) => name.includes('.lock'),
    ),
    [],
  );
});

test('debug CAS treats a future-dated dead owner lock as recoverable corruption', async (t) => {
  const fixture = await makeBrandRuntimeFixture(t);
  const workspace = await createBrandProjectWorkspace({
    projectRoot: fixture.projectRoot,
    ...fixture.identity,
  });
  const store = createFileBackedBrandDebugRuntime({ workspace });
  const initial = await createBrandDebugState({
    taskIdentity: { ...fixture.identity },
    skillId: 'brand-positioning',
    planHash: 'a'.repeat(64),
    evidenceHash: 'b'.repeat(64),
    now: fixture.fixedNow,
  }, store);
  const lockPath = `${workspace.debugStateFile}.lock`;
  await fs.writeFile(lockPath, JSON.stringify({
    token: 'future-dead-owner',
    pid: 2_147_483_647,
    createdAt: '2999-01-01T00:00:00.000Z',
  }));
  await fs.writeFile(`${lockPath}.recovery`, JSON.stringify({
    token: 'future-dead-recovery-owner',
    pid: 2_147_483_647,
    createdAt: '2999-01-01T00:00:00.000Z',
  }));
  const next = await advanceBrandDebugState({
    current: initial,
    event: { type: 'start-planning', note: 'future lock recovered' },
    now: '2026-07-29T00:00:01.000Z',
  }, store);
  assert.equal(next.revision, 1);
  assert.equal(next.timeline[0].note, 'future lock recovered');
  assert.deepEqual(
    (await fs.readdir(workspace.taskRoot)).filter(
      (name) => name.includes('.lock'),
    ),
    [],
  );
});

test('debug lock ownership token is respected and a substituted lock symlink is rejected', async (t) => {
  await t.test('a recovery guard released between lstat and realpath is already recovered', async (t2) => {
    const fixture = await makeBrandRuntimeFixture(t2);
    const workspace = await createBrandProjectWorkspace({
      projectRoot: fixture.projectRoot,
      ...fixture.identity,
    });
    const store = createFileBackedBrandDebugRuntime({ workspace });
    const initial = await createBrandDebugState({
      taskIdentity: { ...fixture.identity },
      skillId: 'brand-positioning',
      planHash: 'a'.repeat(64),
      evidenceHash: 'b'.repeat(64),
      now: fixture.fixedNow,
    }, store);
    const lockPath = `${workspace.debugStateFile}.lock`;
    const guardPath = `${lockPath}.recovery`;
    await fs.writeFile(lockPath, JSON.stringify({
      token: 'dead-target-owner',
      pid: 2_147_483_647,
      createdAt: '2000-01-01T00:00:00.000Z',
    }));
    await fs.writeFile(guardPath, JSON.stringify({
      token: 'released-recovery-owner',
      pid: process.pid,
      createdAt: new Date().toISOString(),
    }));
    const originalRealpath = fs.realpath;
    let releasedAtGuardRealpath = false;
    t2.mock.method(fs, 'realpath', async (...args) => {
      if (
        !releasedAtGuardRealpath
        && path.resolve(args[0]) === path.resolve(guardPath)
      ) {
        releasedAtGuardRealpath = true;
        await fs.unlink(guardPath);
      }
      return originalRealpath(...args);
    });

    const next = await advanceBrandDebugState({
      current: initial,
      event: { type: 'start-planning', note: 'guard owner released normally' },
      now: '2026-07-29T00:00:01.000Z',
    }, store);

    assert.equal(releasedAtGuardRealpath, true);
    assert.equal(next.revision, 1);
    assert.equal(next.timeline[0].note, 'guard owner released normally');
  });

  await t.test('a live recovery guard is never reclaimed', async (t2) => {
    const fixture = await makeBrandRuntimeFixture(t2);
    const workspace = await createBrandProjectWorkspace({
      projectRoot: fixture.projectRoot,
      ...fixture.identity,
    });
    const store = createFileBackedBrandDebugRuntime({ workspace });
    const initial = await createBrandDebugState({
      taskIdentity: { ...fixture.identity },
      skillId: 'brand-positioning',
      planHash: 'a'.repeat(64),
      evidenceHash: 'b'.repeat(64),
      now: fixture.fixedNow,
    }, store);
    const lockPath = `${workspace.debugStateFile}.lock`;
    const guardPath = `${lockPath}.recovery`;
    await fs.writeFile(lockPath, JSON.stringify({
      token: 'dead-target-owner',
      pid: 2_147_483_647,
      createdAt: '2000-01-01T00:00:00.000Z',
    }));
    await fs.writeFile(guardPath, JSON.stringify({
      token: 'live-recovery-owner',
      pid: process.pid,
      createdAt: '2000-01-01T00:00:00.000Z',
    }));
    const advancing = advanceBrandDebugState({
      current: initial,
      event: { type: 'start-planning', note: 'waited for live guard' },
      now: '2026-07-29T00:00:01.000Z',
    }, store);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal((await readJson(guardPath)).token, 'live-recovery-owner');
    assert.equal((await readJson(lockPath)).token, 'dead-target-owner');
    await fs.unlink(guardPath);
    const next = await advancing;
    assert.equal(next.revision, 1);
    assert.equal(next.timeline[0].note, 'waited for live guard');
  });

  await t.test('owner token prevents deleting a replaced lock', async (t2) => {
    const fixture = await makeBrandRuntimeFixture(t2);
    const workspace = await createBrandProjectWorkspace({
      projectRoot: fixture.projectRoot,
      ...fixture.identity,
    });
    const baseStore = createFileBackedBrandDebugRuntime({ workspace });
    const initial = await createBrandDebugState({
      taskIdentity: { ...fixture.identity },
      skillId: 'brand-positioning',
      planHash: 'a'.repeat(64),
      evidenceHash: 'b'.repeat(64),
      now: fixture.fixedNow,
    }, baseStore);
    const lockPath = `${workspace.debugStateFile}.lock`;
    const replacingStore = createFileBackedBrandDebugRuntime({
      workspace,
      atomicWrite: async (...args) => {
        await fs.writeFile(lockPath, JSON.stringify({
          token: 'replacement-owner',
          pid: process.pid,
          createdAt: new Date().toISOString(),
        }));
        return writeJsonAtomic(...args);
      },
    });
    const next = await advanceBrandDebugState({
      current: initial,
      event: { type: 'start-planning' },
      now: '2026-07-29T00:00:01.000Z',
    }, replacingStore);
    assert.equal(next.revision, 1);
    assert.equal((await readJson(lockPath)).token, 'replacement-owner');
    await fs.unlink(lockPath);
  });

  await t.test('pre-existing lock symlink is never followed or removed', async (t2) => {
    const fixture = await makeBrandRuntimeFixture(t2);
    const workspace = await createBrandProjectWorkspace({
      projectRoot: fixture.projectRoot,
      ...fixture.identity,
    });
    const store = createFileBackedBrandDebugRuntime({ workspace });
    const initial = await createBrandDebugState({
      taskIdentity: { ...fixture.identity },
      skillId: 'brand-positioning',
      planHash: 'a'.repeat(64),
      evidenceHash: 'b'.repeat(64),
      now: fixture.fixedNow,
    }, store);
    const outside = path.join(fixture.projectRoot, 'outside-lock-target.json');
    const sentinel = '{"sentinel":"unchanged"}';
    await fs.writeFile(outside, sentinel);
    const lockPath = `${workspace.debugStateFile}.lock`;
    try {
      await fs.symlink(outside, lockPath, 'file');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
        t2.skip(`file symlink unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    await assert.rejects(
      advanceBrandDebugState({
        current: initial,
        event: { type: 'start-planning' },
        now: '2026-07-29T00:00:01.000Z',
      }, store),
      /lock.*symbolic link|symbolic link.*lock/iu,
    );
    assert.equal(await fs.readFile(outside, 'utf8'), sentinel);
    assert.equal((await fs.lstat(lockPath)).isSymbolicLink(), true);
  });
});

test('ordinary request cannot smuggle trusted fields or publication authority', async (t) => {
  const runtime = await makeRuntimeCase(t);
  for (const [field, value] of [
    ['projectRoot', runtime.fixture.projectRoot],
    ['projectContext', runtime.trustedOptions.projectContext],
    ['receiptBinding', runtime.trustedOptions.receiptBinding],
    ['publish', true],
    ['sharedArtifactsRoot', 'shared-artifacts'],
  ]) {
    await assert.rejects(
      runBrandSkillRuntime({
        ...runtime.request,
        [field]: value,
      }, runtime.trustedOptions),
      /unknown field/u,
    );
  }
  await assert.rejects(
    runBrandSkillRuntime(runtime.request, {
      ...runtime.trustedOptions,
      artifactPublisher: async () => {},
    }),
    /unknown field/u,
  );
});

test('brand-visual requires strict trusted policy context without changing non-visual trusted options', async (t) => {
  const visual = await makeVisualRuntimeCase(t);
  const missingPolicy = { ...visual.trustedOptions };
  delete missingPolicy.visualPolicyContext;
  await assert.rejects(
    runBrandSkillRuntime(visual.request, missingPolicy),
    /brand-visual.*brandId.*visualPolicyContext/u,
  );

  const positioning = await makeRuntimeCase(t);
  await assert.rejects(
    runBrandSkillRuntime(positioning.request, {
      ...positioning.trustedOptions,
      brandId: 'brand-001',
      visualPolicyContext: {
        schemaVersion: 1,
        projectContextVersion: 1,
        commanderTaskId: 'commander-task-001',
      },
    }),
    /only allowed for brand-visual/u,
  );
});

test('brand-visual semantic validator runs before Task4 and permits a valid candidate', async (t) => {
  const runtime = await makeVisualRuntimeCase(t);
  const result = await runBrandSkillRuntime(
    runtime.request,
    runtime.trustedOptions,
  );
  assert.equal(result.outcome, 'candidate_ready');
  assert.equal(runtime.reviewCount, 1);
  assert.equal(result.candidate.skillId, 'brand-visual');
  await assert.rejects(
    runBrandSkillRuntime(runtime.request, {
      ...runtime.trustedOptions,
      brandId: 'brand-002',
    }),
    /visual policy context|immutable JSON file conflicts/u,
  );
});

test('brand-visual blocks duplicate visual assets and missing controller public-skill authorization before Task4', async (t) => {
  const duplicate = await makeVisualRuntimeCase(t, {
    duplicateDirections: true,
  });
  const duplicateResult = await runBrandSkillRuntime(
    duplicate.request,
    duplicate.trustedOptions,
  );
  assert.equal(duplicateResult.outcome, 'blocked');
  assert.equal(duplicate.reviewCount, 0);
  assert.match(
    duplicateResult.debugState.blockedReport.blockedReason,
    /semantic|distinct|unique/u,
  );

  const unauthorized = await makeVisualRuntimeCase(t, {
    includePublicHandoff: true,
    publicSkillIds: [],
  });
  const unauthorizedResult = await runBrandSkillRuntime(
    unauthorized.request,
    unauthorized.trustedOptions,
  );
  assert.equal(unauthorizedResult.outcome, 'blocked');
  assert.equal(unauthorized.reviewCount, 0);
  assert.match(
    unauthorizedResult.debugState.blockedReport.blockedReason,
    /publicSkillIds|authorization|semantic/u,
  );
});

test('callback cannot redirect candidate writes or invalidate project identity', async (t) => {
  await t.test('candidate directory junction', async (t2) => {
    const runtime = await makeRuntimeCase(t2);
    const originalExecute = runtime.trustedOptions.executeModules;
    const escaped = path.join(runtime.fixture.projectRoot, 'escaped-candidates');
    await fs.mkdir(escaped);
    runtime.trustedOptions.executeModules = async (input) => {
      await fs.rm(input.workspace.candidatesRoot, { recursive: true });
      await fs.symlink(escaped, input.workspace.candidatesRoot, 'junction');
      return originalExecute(input);
    };
    await assert.rejects(
      runBrandSkillRuntime(runtime.request, runtime.trustedOptions),
      (error) => {
        assert.equal(error.code, 'WORKSPACE_REVALIDATION_FAILED');
        return /symbolic link|boundary/u.test(error.message);
      },
    );
    assert.deepEqual(await fs.readdir(escaped), []);
  });

  await t.test('project identity changed after callback', async (t2) => {
    const runtime = await makeRuntimeCase(t2);
    const originalExecute = runtime.trustedOptions.executeModules;
    runtime.trustedOptions.executeModules = async (input) => {
      await fs.writeFile(runtime.fixture.projectFile, JSON.stringify({
        ...runtime.fixture.projectRecord,
        businessProjectId: '20260729-999-other',
      }));
      return originalExecute(input);
    };
    await assert.rejects(
      runBrandSkillRuntime(runtime.request, runtime.trustedOptions),
      (error) => {
        assert.equal(error.code, 'WORKSPACE_REVALIDATION_FAILED');
        return /project identity/u.test(error.message);
      },
    );
  });
});
