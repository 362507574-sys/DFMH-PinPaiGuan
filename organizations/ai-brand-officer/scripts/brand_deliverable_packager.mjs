import { types as utilTypes } from 'node:util';

import {
  BRAND_SKILL_MODULES,
  assertPlain,
  rejectUnknown,
  safeId,
  stableSha256,
  stableStringify,
  validateTaskIdentity,
} from './brand_contracts.mjs';
import {
  validateBrandDebugState,
} from './brand_debug_controller.mjs';
import {
  validateBrandEvidenceBundle,
} from './brand_evidence_engine.mjs';
import {
  validateBrandCandidateReview,
} from './brand_quality_gate.mjs';
import {
  validateBrandTaskPlan,
} from './brand_task_planner.mjs';

const INPUT_FIELDS = Object.freeze([
  'plan',
  'evidenceBundle',
  'candidate',
  'review',
  'debugState',
]);
const TRUSTED_FIELDS = Object.freeze([
  'evidenceTrustedOptions',
  'reviewTrustedOptions',
  'debugTrustedRuntime',
  'deliveryContext',
  'baseCandidateHash',
  'executionContextCommitment',
  'deliveryContextCommitment',
  'policyContextHash',
]);
const REQUIRED_TRUSTED_FIELDS = Object.freeze([
  'evidenceTrustedOptions',
  'reviewTrustedOptions',
  'debugTrustedRuntime',
]);
const CONTENT_JSON_BYTE_BUDGET = 1024 * 1024;

/**
 * Produces a deterministic, candidate-only package. This function deliberately
 * has no filesystem or artifact-publishing dependency.
 */
export async function packageBrandDeliverable(inputValue, trustedOptionsValue) {
  const input = snapshotStableJson(inputValue, 'brand deliverable input');
  assertPlain(input, 'brand deliverable input');
  rejectUnknown(input, INPUT_FIELDS, 'brand deliverable input');
  requireFields(input, INPUT_FIELDS, 'brand deliverable input');
  const trusted = validateTrustedOptions(trustedOptionsValue);

  validateBrandTaskPlan(input.plan);
  await validateBrandEvidenceBundle(
    input.evidenceBundle,
    trusted.evidenceTrustedOptions,
  );
  await validateBrandCandidateReview(
    input.review,
    trusted.reviewTrustedOptions,
  );
  await validateBrandDebugState(
    input.debugState,
    trusted.debugTrustedRuntime,
  );

  assertTrustedReplayBindings(input, trusted);
  assertPackageBindings(input);

  const evidenceRefs = input.evidenceBundle.entries.map((entry) => ({
    evidenceId: entry.evidenceId,
    category: entry.category,
    sourceRef: entry.sourceRef,
    confidence: entry.confidence,
  }));
  const deliveryContext = normalizeDeliveryContext(
    trusted.deliveryContext,
    input,
  );
  const businessEntries = input.evidenceBundle.entries.map((entry) => ({
    evidenceId: entry.evidenceId,
    category: entry.category,
    claim: entry.claim,
    sourceRef: entry.sourceRef,
    confidence: entry.confidence,
  }));
  const factCategories = [
    'upstream-artifact',
    'feishu',
    'conversation',
    'public-web',
  ];
  const facts = businessEntries.filter(
    (entry) => factCategories.includes(entry.category)
      && entry.confidence === 'confirmed',
  );
  const judgments = businessEntries.filter((entry) => [
    'professional-judgment',
    'inference',
  ].includes(entry.category));
  const assumptions = businessEntries.filter(
    (entry) => entry.category === 'assumption'
      || (
        factCategories.includes(entry.category)
        && ['supported', 'provisional'].includes(entry.confidence)
      ),
  );
  const unknowns = businessEntries.filter(
    (entry) => entry.category === 'unknown'
      || entry.confidence === 'unknown',
  );
  const commitments = buildDeliveryContextCommitments({
    input,
    deliveryContext,
    policyContextHash: trusted.policyContextHash,
  });
  if (
    trusted.baseCandidateHash !== undefined
    && trusted.baseCandidateHash !== commitments.baseCandidateHash
  ) throw new Error('trusted base candidate hash does not match');
  if (
    trusted.executionContextCommitment !== undefined
    && trusted.executionContextCommitment
      !== commitments.executionContextCommitment
  ) throw new Error('trusted execution context commitment does not match');
  if (
    trusted.deliveryContextCommitment !== undefined
    && trusted.deliveryContextCommitment !== commitments.deliveryContextCommitment
  ) throw new Error('trusted delivery context commitment does not match');
  const eliminationAndReworkHistory = [];
  for (const entry of input.debugState.timeline.filter(
    (item) => item.eventType === 'review-failed',
  )) {
    const resolution = await trusted.debugTrustedRuntime.resolveReview(
      entry.reviewHash,
    );
    eliminationAndReworkHistory.push({
      reviewHash: resolution.review.reviewHash,
      candidateId: resolution.review.candidateId,
      verdict: resolution.review.verdict,
      failedCriteria: [...resolution.review.failedCriteria],
      hardVetoes: [...resolution.review.hardVetoes],
      correctionTargets: [...resolution.review.correctionTargets],
      affectedModuleIds: [...resolution.diagnostic.affectedModuleIds],
      requiresBusinessDecision: resolution.diagnostic.requiresBusinessDecision,
      blockedReason: resolution.diagnostic.blockedReason,
      remainingRisks: [...resolution.diagnostic.remainingRisks],
      requestedBusinessInput: [...resolution.diagnostic.requestedBusinessInput],
      roundId: entry.roundId ?? null,
      treatmentId: input.debugState.attemptedCorrections.find(
        (item) => item.roundId === entry.roundId,
      )?.treatmentId ?? (
        input.debugState.activeCorrection?.roundId === entry.roundId
          ? input.debugState.activeCorrection.treatmentId
          : null
      ),
      validationVerdict: input.debugState.attemptedCorrections.find(
        (item) => item.roundId === entry.roundId,
      )?.validationVerdict ?? null,
    });
  }
  const debugTimeline = input.debugState.timeline.map((entry) => ({
    sequence: entry.sequence,
    at: entry.at,
    eventType: entry.eventType,
    fromStatus: entry.fromStatus,
    toStatus: entry.toStatus,
    eventHash: entry.eventHash,
    reviewHash: entry.reviewHash ?? null,
    candidateHash: entry.candidateHash ?? null,
    rootCauseFingerprint: entry.rootCauseFingerprint ?? null,
    roundId: entry.roundId ?? null,
  }));
  const humanSummary = {
    conclusion: `候选方案已通过审核：${deliveryContext.businessConclusion}`,
    basis: boundedUniqueSummaryItems([
      `执行模块：${input.plan.selectedModuleIds.join('、')}。`,
      ...deliveryContext.confirmedConclusions.map(
        (item) => `已确认结论：${item}`,
      ),
      ...facts.slice(0, 10).map((item) => `事实依据：${item.claim}`),
    ]),
    limitations: boundedUniqueSummaryItems([
      ...input.evidenceBundle.limitations,
      ...deliveryContext.riskNotes,
      ...assumptions.map(
        (item) => `暂定信息（${item.confidence}，来源 ${item.sourceRef}）：${item.claim}`,
      ),
      ...unknowns.map((item) => item.claim),
      ...eliminationAndReworkHistory.flatMap(
        (item) => [
          ...item.failedCriteria,
          ...item.hardVetoes,
          ...item.correctionTargets,
        ].map((reason) => `历史淘汰/返工原因：${reason}`),
      ),
    ]),
    nextStep: deliveryContext.decisionRequests.length > 0
      ? `请帝王决策：${deliveryContext.decisionRequests.join('；')}`
      : deliveryContext.nextOrganizationRecommendation === null
        ? '交回控制中心锁定候选版本；正式发布与共享成果晋级仍由控制中心负责。'
        : `建议下一主责组织：${deliveryContext.nextOrganizationRecommendation.organizationId}；${deliveryContext.nextOrganizationRecommendation.reason}`,
  };
  const contentJson = stableStringify(input.candidate.content);
  if (Buffer.byteLength(contentJson, 'utf8') > CONTENT_JSON_BYTE_BUDGET) {
    throw new Error('candidate contentJson exceeds the 1 MiB UTF-8 byte budget');
  }
  const stateJson = stableStringify(input.debugState);
  const systemPackage = {
    schemaVersion: 1,
    artifactVersion: 1,
    artifactStatus: 'organization_candidate',
    lifecycleStatus: 'candidate_ready',
    taskIdentity: {
      enterpriseId: input.plan.enterpriseId,
      businessProjectId: input.plan.businessProjectId,
      taskId: input.plan.taskId,
    },
    skillId: input.plan.skillId,
    selectedModuleIds: [...input.plan.selectedModuleIds],
    candidateId: input.candidate.candidateId,
    planHash: input.plan.planHash,
    evidenceHash: input.evidenceBundle.evidenceHash,
    candidateHash: input.candidate.candidateHash,
    reviewHash: input.review.reviewHash,
    debugStateHash: input.debugState.stateHash,
    baseCandidateHash: commitments.baseCandidateHash,
    executionContextCommitment: commitments.executionContextCommitment,
    deliveryContextCommitment: commitments.deliveryContextCommitment,
    policyContextHash: trusted.policyContextHash,
    output: {
      candidateId: input.candidate.candidateId,
      candidateHash: input.candidate.candidateHash,
      contentSha256: stableSha256(input.candidate.content),
      contentJson,
    },
    evidenceRefs,
    upstreamArtifacts: input.plan.upstreamArtifacts.map((artifact) => ({
      ...artifact,
    })),
    review: {
      candidateId: input.review.candidateId,
      verdict: input.review.verdict,
      score: input.review.score,
      hardVetoes: [...input.review.hardVetoes],
      failedCriteria: [...input.review.failedCriteria],
      correctionTargets: [...input.review.correctionTargets],
      reviewHash: input.review.reviewHash,
    },
    businessContent: {
      facts,
      judgments,
      assumptions,
      unknowns,
      businessConclusion: deliveryContext.businessConclusion,
      recommendedCandidate: deliveryContext.recommendedCandidate,
      confirmedConclusions: deliveryContext.confirmedConclusions,
      riskNotes: deliveryContext.riskNotes,
      decisionRequests: deliveryContext.decisionRequests,
    },
    downstreamInstructions: {
      mustPreserve: deliveryContext.mustPreserve,
      mayAdapt: deliveryContext.mayAdapt,
      forbiddenChanges: deliveryContext.forbiddenChanges,
    },
    eliminationAndReworkHistory,
    nextOrganizationRecommendation:
      deliveryContext.nextOrganizationRecommendation,
    debugTrace: {
      status: input.debugState.status,
      revision: input.debugState.revision,
      stateHash: input.debugState.stateHash,
      stateSha256: stableSha256(input.debugState),
      stateJson,
      attemptedCorrectionCount: input.debugState.attemptedCorrections.length,
      timeline: debugTimeline,
    },
  };
  const withoutHash = { humanSummary, systemPackage };
  return validateBrandDeliverablePackage({
    ...withoutHash,
    sha256: stableSha256(withoutHash),
  });
}

function boundedUniqueSummaryItems(values) {
  const unique = [...new Set(values)];
  if (unique.length <= 100) return unique;
  const retained = unique.slice(0, 99);
  retained.push(`另有 ${unique.length - retained.length} 项已省略。`);
  return retained;
}

function validateTrustedOptions(value) {
  if (utilTypes.isProxy(value)) {
    throw new TypeError('trusted options must not be a Proxy');
  }
  assertPlain(value, 'trusted options');
  rejectUnknown(value, TRUSTED_FIELDS, 'trusted options');
  requireFields(value, REQUIRED_TRUSTED_FIELDS, 'trusted options');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const field of REQUIRED_TRUSTED_FIELDS) {
    const descriptor = descriptors[field];
    if (
      descriptor === undefined
      || descriptor.get !== undefined
      || descriptor.set !== undefined
      || descriptor.enumerable !== true
    ) {
      throw new TypeError(`trusted options ${field} must be an enumerable data field`);
    }
  }
  const policyContextHash = descriptors.policyContextHash?.value ?? null;
  if (
    policyContextHash !== null
    && (
      typeof policyContextHash !== 'string'
      || !/^[a-f0-9]{64}$/u.test(policyContextHash)
    )
  ) throw new Error('trusted policyContextHash is invalid');
  return {
    evidenceTrustedOptions: descriptors.evidenceTrustedOptions.value,
    reviewTrustedOptions: descriptors.reviewTrustedOptions.value,
    debugTrustedRuntime: descriptors.debugTrustedRuntime.value,
    deliveryContext: Object.hasOwn(descriptors, 'deliveryContext')
      ? snapshotStableJson(
        descriptors.deliveryContext.value,
        'trusted delivery context',
      )
      : undefined,
    baseCandidateHash: descriptors.baseCandidateHash?.value,
    executionContextCommitment:
      descriptors.executionContextCommitment?.value,
    deliveryContextCommitment:
      descriptors.deliveryContextCommitment?.value,
    policyContextHash,
  };
}

function assertTrustedReplayBindings(input, trusted) {
  const reviewTrusted = trusted.reviewTrustedOptions;
  assertPlain(reviewTrusted, 'review trusted options');
  if (stableStringify(input.plan) !== stableStringify(reviewTrusted.plan)) {
    throw new Error('deliverable plan does not match the trusted review plan');
  }
  if (
    stableStringify(input.evidenceBundle)
    !== stableStringify(reviewTrusted.evidenceBundle)
  ) {
    throw new Error(
      'deliverable evidence bundle does not match the trusted review evidence',
    );
  }
  if (
    stableStringify(input.candidate)
    !== stableStringify(reviewTrusted.candidate)
  ) {
    throw new Error(
      'deliverable candidate/candidateHash does not match the trusted reviewed candidate',
    );
  }
  if (
    stableStringify(trusted.evidenceTrustedOptions)
    !== stableStringify(reviewTrusted.evidenceTrustedOptions)
  ) {
    throw new Error('evidence trusted options do not match the review replay');
  }
}

function assertPackageBindings({
  plan,
  evidenceBundle,
  candidate,
  review,
  debugState,
}) {
  const identity = validateTaskIdentity({
    enterpriseId: plan.enterpriseId,
    businessProjectId: plan.businessProjectId,
    taskId: plan.taskId,
  });
  for (const [label, observed] of [
    ['evidence bundle', evidenceBundle.taskIdentity],
    ['review', review.taskIdentity],
    ['debug state', debugState.taskIdentity],
  ]) {
    if (stableStringify(identity) !== stableStringify(observed)) {
      throw new Error(`${label} task identity does not match plan`);
    }
  }
  for (const field of ['enterpriseId', 'businessProjectId', 'taskId']) {
    if (candidate[field] !== identity[field]) {
      throw new Error(`candidate ${field} does not match plan`);
    }
  }
  for (const [label, skillId] of [
    ['evidence bundle', evidenceBundle.skillId],
    ['candidate', candidate.skillId],
    ['review', review.skillId],
    ['debug state', debugState.skillId],
  ]) {
    if (skillId !== plan.skillId) {
      throw new Error(`${label} skillId does not match plan`);
    }
  }
  if (
    review.planHash !== plan.planHash
    || debugState.planHash !== plan.planHash
  ) {
    throw new Error('planHash binding does not match');
  }
  if (
    review.evidenceHash !== evidenceBundle.evidenceHash
    || debugState.evidenceHash !== evidenceBundle.evidenceHash
  ) {
    throw new Error('evidenceHash binding does not match');
  }
  if (
    review.candidateId !== candidate.candidateId
    || review.candidateHash !== candidate.candidateHash
  ) {
    throw new Error('candidate binding does not match review');
  }
  if (
    !['candidate_ready', 'preferred'].includes(review.verdict)
    || review.hardVetoes.length !== 0
    || review.failedCriteria.length !== 0
  ) {
    throw new Error('deliverable requires a passing candidate_ready or preferred review');
  }
  if (debugState.status !== 'candidate_ready') {
    throw new Error('deliverable debug state must be candidate_ready');
  }
  const finalReview = [...debugState.timeline].reverse().find(
    (entry) => entry.eventType === 'review-passed',
  );
  if (
    finalReview === undefined
    || finalReview.reviewHash !== review.reviewHash
    || finalReview.candidateHash !== candidate.candidateHash
    || finalReview.candidateId !== candidate.candidateId
  ) {
    throw new Error('debug state final passing review binding does not match');
  }
  if (
    stableStringify(sortArtifacts(plan.upstreamArtifacts))
    !== stableStringify(sortArtifacts(evidenceBundle.upstreamArtifacts))
  ) {
    throw new Error('upstream artifact bindings do not match evidence');
  }
}

function sortArtifacts(values) {
  return values
    .map((item) => ({ ...item }))
    .sort((left, right) => (
      left.artifactId.localeCompare(right.artifactId, 'en')
      || left.version - right.version
    ));
}

function normalizeDeliveryContext(value, input) {
  const defaultConclusion = extractBusinessConclusion(input.candidate.content);
  if (value === undefined) {
    return {
      businessConclusion: defaultConclusion,
      recommendedCandidate: input.candidate.candidateId,
      confirmedConclusions: [defaultConclusion],
      riskNotes: [],
      decisionRequests: [],
      mustPreserve: [...input.plan.acceptanceCriteria],
      mayAdapt: [],
      forbiddenChanges: [...input.plan.stopConditions],
      nextOrganizationRecommendation: null,
    };
  }
  assertPlain(value, 'trusted delivery context');
  const fields = [
    'businessConclusion',
    'recommendedCandidate',
    'confirmedConclusions',
    'riskNotes',
    'decisionRequests',
    'mustPreserve',
    'mayAdapt',
    'forbiddenChanges',
    'nextOrganizationRecommendation',
  ];
  rejectUnknown(value, fields, 'trusted delivery context');
  requireFields(value, fields, 'trusted delivery context');
  const result = {
    businessConclusion: validateText(value.businessConclusion, 'businessConclusion'),
    recommendedCandidate: validateText(
      value.recommendedCandidate,
      'recommendedCandidate',
    ),
    confirmedConclusions: validateTextArray(
      value.confirmedConclusions,
      'confirmedConclusions',
      1,
    ),
    riskNotes: validateTextArray(value.riskNotes, 'riskNotes'),
    decisionRequests: validateTextArray(
      value.decisionRequests,
      'decisionRequests',
    ),
    mustPreserve: validateTextArray(value.mustPreserve, 'mustPreserve', 1),
    mayAdapt: validateTextArray(value.mayAdapt, 'mayAdapt'),
    forbiddenChanges: validateTextArray(
      value.forbiddenChanges,
      'forbiddenChanges',
      1,
    ),
    nextOrganizationRecommendation: value.nextOrganizationRecommendation,
  };
  if (result.nextOrganizationRecommendation !== null) {
    assertPlain(
      result.nextOrganizationRecommendation,
      'nextOrganizationRecommendation',
    );
    rejectUnknown(
      result.nextOrganizationRecommendation,
      ['organizationId', 'reason'],
      'nextOrganizationRecommendation',
    );
    requireFields(
      result.nextOrganizationRecommendation,
      ['organizationId', 'reason'],
      'nextOrganizationRecommendation',
    );
    result.nextOrganizationRecommendation = {
      organizationId: validateText(
        result.nextOrganizationRecommendation.organizationId,
        'nextOrganizationRecommendation organizationId',
      ),
      reason: validateText(
        result.nextOrganizationRecommendation.reason,
        'nextOrganizationRecommendation reason',
      ),
    };
  }
  return result;
}

function buildDeliveryContextCommitments({
  input,
  deliveryContext,
  policyContextHash,
}) {
  const commitmentField = '_brandDeliveryContextCommitment';
  const taskIdentity = {
    enterpriseId: input.plan.enterpriseId,
    businessProjectId: input.plan.businessProjectId,
    taskId: input.plan.taskId,
  };
  if (!Object.hasOwn(input.candidate.content, commitmentField)) {
    throw new Error('candidate is missing its delivery context commitment anchor');
  }
  const {
    [commitmentField]: anchoredCommitment,
    ...baseContent
  } = input.candidate.content;
  const {
    candidateHash: ignoredCandidateHash,
    ...anchoredCandidateWithoutHash
  } = input.candidate;
  const baseCandidateHash = stableSha256({
    ...anchoredCandidateWithoutHash,
    content: baseContent,
  });
  const executionPayload = {
    deliveryContext,
    baseCandidateHash,
    taskIdentity,
    skillId: input.plan.skillId,
    planHash: input.plan.planHash,
    evidenceHash: input.evidenceBundle.evidenceHash,
    ...(policyContextHash === null
      ? {}
      : { policyContextHash }),
  };
  const executionContextCommitment = stableSha256(executionPayload);
  if (anchoredCommitment !== executionContextCommitment) {
    throw new Error('candidate delivery context commitment anchor is invalid');
  }
  return {
    baseCandidateHash,
    executionContextCommitment,
    deliveryContextCommitment: stableSha256({
      ...executionPayload,
      candidateHash: input.candidate.candidateHash,
      reviewHash: input.review.reviewHash,
      executionContextCommitment,
    }),
  };
}

function extractBusinessConclusion(content) {
  if (Array.isArray(content?.sections)) {
    const sectionContent = content.sections.find(
      (section) => typeof section?.content === 'string'
        && section.content.trim() !== '',
    )?.content;
    if (sectionContent !== undefined) return sectionContent.trim().slice(0, 10000);
  }
  for (const field of ['businessConclusion', 'conclusion', 'summary']) {
    if (typeof content?.[field] === 'string' && content[field].trim() !== '') {
      return content[field].trim().slice(0, 10000);
    }
  }
  const values = [];
  const collect = (value) => {
    if (typeof value === 'string' && value.trim() !== '') {
      values.push(value.trim());
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collect(item);
    } else if (value !== null && typeof value === 'object') {
      for (const item of Object.values(value)) collect(item);
    }
  };
  collect(content);
  return (values[0] ?? stableStringify(content)).slice(0, 10000);
}

function validateText(value, label, maximum = 10000) {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || value.length === 0
    || value.length > maximum
  ) throw new TypeError(`${label} must be normalized non-empty text`);
  return value;
}

function validateTextArray(value, label, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum || value.length > 100) {
    throw new TypeError(`${label} must contain ${minimum}-100 text items`);
  }
  return value.map((item, index) => validateText(
    item,
    `${label}[${index}]`,
    4000,
  ));
}

export function validateBrandDeliverablePackage(value) {
  const result = snapshotStableJson(value, 'brand deliverable package');
  assertPlain(result, 'brand deliverable package');
  exactObject(
    result,
    ['humanSummary', 'systemPackage', 'sha256'],
    'brand deliverable package',
  );
  validateSha(result.sha256, 'package sha256');
  const human = result.humanSummary;
  exactObject(
    human,
    ['conclusion', 'basis', 'limitations', 'nextStep'],
    'humanSummary',
  );
  validateText(human.conclusion, 'humanSummary conclusion');
  validateTextArray(human.basis, 'humanSummary basis', 1);
  validateTextArray(human.limitations, 'humanSummary limitations');
  validateText(human.nextStep, 'humanSummary nextStep', 4000);

  const system = result.systemPackage;
  const systemFields = [
    'schemaVersion',
    'artifactVersion',
    'artifactStatus',
    'lifecycleStatus',
    'taskIdentity',
    'skillId',
    'selectedModuleIds',
    'candidateId',
    'planHash',
    'evidenceHash',
    'candidateHash',
    'reviewHash',
    'debugStateHash',
    'baseCandidateHash',
    'executionContextCommitment',
    'deliveryContextCommitment',
    'policyContextHash',
    'output',
    'evidenceRefs',
    'upstreamArtifacts',
    'review',
    'businessContent',
    'downstreamInstructions',
    'eliminationAndReworkHistory',
    'nextOrganizationRecommendation',
    'debugTrace',
  ];
  exactObject(system, systemFields, 'systemPackage');
  if (
    system.schemaVersion !== 1
    || system.artifactVersion !== 1
    || system.artifactStatus !== 'organization_candidate'
    || system.lifecycleStatus !== 'candidate_ready'
  ) throw new Error('systemPackage version/status is invalid');
  validateTaskIdentity(system.taskIdentity);
  if (!Object.hasOwn(BRAND_SKILL_MODULES, system.skillId)) {
    throw new Error('systemPackage skillId is invalid');
  }
  validateTextArray(system.selectedModuleIds, 'selectedModuleIds', 1);
  if (
    system.selectedModuleIds.length > 5
    || new Set(system.selectedModuleIds).size !== system.selectedModuleIds.length
    || system.selectedModuleIds.some(
      (moduleId) => !BRAND_SKILL_MODULES[system.skillId].includes(moduleId),
    )
  ) throw new Error('selectedModuleIds do not belong to the skill');
  safeId(system.candidateId, 'systemPackage candidateId');
  for (const field of [
    'planHash',
    'evidenceHash',
    'candidateHash',
    'reviewHash',
    'debugStateHash',
    'baseCandidateHash',
    'executionContextCommitment',
    'deliveryContextCommitment',
  ]) validateSha(system[field], `systemPackage ${field}`);
  if (
    system.policyContextHash !== null
    && (
      typeof system.policyContextHash !== 'string'
      || !/^[a-f0-9]{64}$/u.test(system.policyContextHash)
    )
  ) throw new Error('systemPackage policyContextHash is invalid');

  exactObject(
    system.output,
    ['candidateId', 'candidateHash', 'contentSha256', 'contentJson'],
    'systemPackage output',
  );
  safeId(system.output.candidateId, 'output candidateId');
  validateSha(system.output.candidateHash, 'output candidateHash');
  validateSha(system.output.contentSha256, 'output contentSha256');
  if (
    typeof system.output.contentJson !== 'string'
    || Buffer.byteLength(system.output.contentJson, 'utf8')
      > CONTENT_JSON_BYTE_BUDGET
  ) throw new Error('contentJson exceeds the 1 MiB UTF-8 byte budget');
  let parsedContent;
  try {
    parsedContent = JSON.parse(system.output.contentJson);
  } catch (error) {
    throw new Error(`contentJson is invalid JSON: ${error.message}`, {
      cause: error,
    });
  }
  if (stableStringify(parsedContent) !== system.output.contentJson) {
    throw new Error('contentJson must be canonical JSON');
  }
  if (stableSha256(parsedContent) !== system.output.contentSha256) {
    throw new Error('contentJson hash binding is invalid');
  }
  if (
    system.output.candidateId !== system.candidateId
    || system.output.candidateHash !== system.candidateHash
  ) throw new Error('output candidate binding is invalid');

  validateArrayOfExactEvidence(system.evidenceRefs, false, 'evidenceRefs');
  validateArrayOfExactEvidence(
    system.businessContent.facts,
    true,
    'businessContent facts',
  );
  validateArrayOfExactEvidence(
    system.businessContent.judgments,
    true,
    'businessContent judgments',
  );
  validateArrayOfExactEvidence(
    system.businessContent.assumptions,
    true,
    'businessContent assumptions',
  );
  validateArrayOfExactEvidence(
    system.businessContent.unknowns,
    true,
    'businessContent unknowns',
  );
  if (!Array.isArray(system.upstreamArtifacts)) {
    throw new TypeError('upstreamArtifacts must be an array');
  }
  for (const [index, artifact] of system.upstreamArtifacts.entries()) {
    exactObject(
      artifact,
      ['artifactId', 'version', 'sha256', 'sourceOrganizationId'],
      `upstreamArtifacts[${index}]`,
    );
    safeId(artifact.artifactId, 'artifactId');
    safeId(artifact.sourceOrganizationId, 'sourceOrganizationId');
    validateSha(artifact.sha256, 'artifact sha256');
    if (!Number.isSafeInteger(artifact.version) || artifact.version < 1) {
      throw new TypeError('artifact version must be a positive integer');
    }
  }
  exactObject(
    system.review,
    [
      'candidateId',
      'verdict',
      'score',
      'hardVetoes',
      'failedCriteria',
      'correctionTargets',
      'reviewHash',
    ],
    'review',
  );
  if (!['preferred', 'candidate_ready'].includes(system.review.verdict)) {
    throw new Error('review verdict must be passing');
  }
  safeId(system.review.candidateId, 'review candidateId');
  if (
    typeof system.review.score !== 'number'
    || system.review.score < 0
    || system.review.score > 100
  ) throw new Error('review score is invalid');
  validateTextArray(system.review.hardVetoes, 'review hardVetoes');
  validateTextArray(system.review.failedCriteria, 'review failedCriteria');
  validateTextArray(system.review.correctionTargets, 'review correctionTargets');
  if (
    system.review.hardVetoes.length !== 0
    || system.review.failedCriteria.length !== 0
  ) throw new Error('passing review cannot contain vetoes or failed criteria');
  validateSha(system.review.reviewHash, 'review reviewHash');
  if (
    system.review.candidateId !== system.candidateId
    || system.review.reviewHash !== system.reviewHash
  ) throw new Error('review summary binding is invalid');

  exactObject(
    system.businessContent,
    [
      'facts',
      'judgments',
      'assumptions',
      'unknowns',
      'businessConclusion',
      'recommendedCandidate',
      'confirmedConclusions',
      'riskNotes',
      'decisionRequests',
    ],
    'businessContent',
  );
  validateText(system.businessContent.businessConclusion, 'businessConclusion');
  validateText(system.businessContent.recommendedCandidate, 'recommendedCandidate');
  validateTextArray(
    system.businessContent.confirmedConclusions,
    'confirmedConclusions',
    1,
  );
  validateTextArray(system.businessContent.riskNotes, 'riskNotes');
  validateTextArray(system.businessContent.decisionRequests, 'decisionRequests');
  exactObject(
    system.downstreamInstructions,
    ['mustPreserve', 'mayAdapt', 'forbiddenChanges'],
    'downstreamInstructions',
  );
  validateTextArray(
    system.downstreamInstructions.mustPreserve,
    'mustPreserve',
    1,
  );
  validateTextArray(system.downstreamInstructions.mayAdapt, 'mayAdapt');
  validateTextArray(
    system.downstreamInstructions.forbiddenChanges,
    'forbiddenChanges',
    1,
  );
  validateHistory(system.eliminationAndReworkHistory);
  if (system.nextOrganizationRecommendation !== null) {
    exactObject(
      system.nextOrganizationRecommendation,
      ['organizationId', 'reason'],
      'nextOrganizationRecommendation',
    );
    validateText(
      system.nextOrganizationRecommendation.organizationId,
      'next organizationId',
    );
    safeId(
      system.nextOrganizationRecommendation.organizationId,
      'next organizationId',
    );
    validateText(
      system.nextOrganizationRecommendation.reason,
      'next organization reason',
    );
  }
  const packagedDeliveryContext = {
    businessConclusion: system.businessContent.businessConclusion,
    recommendedCandidate: system.businessContent.recommendedCandidate,
    confirmedConclusions: system.businessContent.confirmedConclusions,
    riskNotes: system.businessContent.riskNotes,
    decisionRequests: system.businessContent.decisionRequests,
    mustPreserve: system.downstreamInstructions.mustPreserve,
    mayAdapt: system.downstreamInstructions.mayAdapt,
    forbiddenChanges: system.downstreamInstructions.forbiddenChanges,
    nextOrganizationRecommendation: system.nextOrganizationRecommendation,
  };
  const reservedCommitment =
    parsedContent._brandDeliveryContextCommitment;
  if (
    reservedCommitment !== system.executionContextCommitment
  ) throw new Error('candidate content delivery commitment anchor is invalid');
  const {
    _brandDeliveryContextCommitment: ignoredReserved,
    ...baseContent
  } = parsedContent;
  const derivedBaseCandidateHash = stableSha256({
    candidateId: system.candidateId,
    enterpriseId: system.taskIdentity.enterpriseId,
    businessProjectId: system.taskIdentity.businessProjectId,
    taskId: system.taskIdentity.taskId,
    skillId: system.skillId,
    content: baseContent,
  });
  if (derivedBaseCandidateHash !== system.baseCandidateHash) {
    throw new Error('base candidate hash binding is invalid');
  }
  const derivedAnchoredCandidateHash = stableSha256({
    candidateId: system.candidateId,
    enterpriseId: system.taskIdentity.enterpriseId,
    businessProjectId: system.taskIdentity.businessProjectId,
    taskId: system.taskIdentity.taskId,
    skillId: system.skillId,
    content: parsedContent,
  });
  if (derivedAnchoredCandidateHash !== system.candidateHash) {
    throw new Error('anchored candidateHash binding is invalid');
  }
  const executionContextCommitment = stableSha256({
    deliveryContext: packagedDeliveryContext,
    baseCandidateHash: system.baseCandidateHash,
    taskIdentity: system.taskIdentity,
    skillId: system.skillId,
    planHash: system.planHash,
    evidenceHash: system.evidenceHash,
    ...(system.policyContextHash === null
      ? {}
      : { policyContextHash: system.policyContextHash }),
  });
  const expectedDeliveryContextCommitment = stableSha256({
    deliveryContext: packagedDeliveryContext,
    baseCandidateHash: system.baseCandidateHash,
    candidateHash: system.candidateHash,
    taskIdentity: system.taskIdentity,
    skillId: system.skillId,
    planHash: system.planHash,
    evidenceHash: system.evidenceHash,
    ...(system.policyContextHash === null
      ? {}
      : { policyContextHash: system.policyContextHash }),
    reviewHash: system.reviewHash,
    executionContextCommitment,
  });
  if (
    expectedDeliveryContextCommitment !== system.deliveryContextCommitment
  ) throw new Error('delivery context commitment binding is invalid');

  exactObject(
    system.debugTrace,
    [
      'status',
      'revision',
      'stateHash',
      'stateSha256',
      'stateJson',
      'attemptedCorrectionCount',
      'timeline',
    ],
    'debugTrace',
  );
  if (system.debugTrace.status !== 'candidate_ready') {
    throw new Error('debugTrace status must be candidate_ready');
  }
  validateSha(system.debugTrace.stateHash, 'debugTrace stateHash');
  validateSha(system.debugTrace.stateSha256, 'debugTrace stateSha256');
  if (
    typeof system.debugTrace.stateJson !== 'string'
    || system.debugTrace.stateJson.length < 2
    || system.debugTrace.stateJson.length > 4_194_304
  ) throw new Error('debug stateJson length is invalid');
  if (system.debugTrace.stateHash !== system.debugStateHash) {
    throw new Error('debug state binding is invalid');
  }
  let parsedState;
  try {
    parsedState = JSON.parse(system.debugTrace.stateJson);
  } catch (error) {
    throw new Error(`debug stateJson is invalid: ${error.message}`, {
      cause: error,
    });
  }
  if (
    stableStringify(parsedState) !== system.debugTrace.stateJson
    || stableSha256(parsedState) !== system.debugTrace.stateSha256
    || parsedState.stateHash !== system.debugTrace.stateHash
  ) throw new Error('debug stateJson binding is invalid');
  if (
    !Number.isSafeInteger(system.debugTrace.revision)
    || system.debugTrace.revision < 1
    || system.debugTrace.revision !== parsedState.revision
    || system.debugTrace.attemptedCorrectionCount
      !== parsedState.attemptedCorrections.length
    || stableStringify(system.debugTrace.timeline)
      !== stableStringify(projectTimeline(parsedState.timeline))
  ) throw new Error('debug trace does not match stateJson');
  if (result.sha256 !== stableSha256({
    humanSummary: human,
    systemPackage: system,
  })) throw new Error('deliverable package sha256 does not match content');
  return deepFreeze(result);
}

function validateArrayOfExactEvidence(value, includeClaim, label) {
  if (!Array.isArray(value) || value.length > 1000) {
    throw new TypeError(`${label} must be an array`);
  }
  for (const [index, item] of value.entries()) {
    exactObject(
      item,
      includeClaim
        ? ['evidenceId', 'category', 'claim', 'sourceRef', 'confidence']
        : ['evidenceId', 'category', 'sourceRef', 'confidence'],
      `${label}[${index}]`,
    );
    safeId(item.evidenceId, `${label} evidenceId`);
    if (![
      'upstream-artifact',
      'feishu',
      'conversation',
      'public-web',
      'professional-judgment',
      'inference',
      'assumption',
      'unknown',
    ].includes(item.category)) throw new Error(`${label} category is invalid`);
    if (includeClaim) validateText(item.claim, `${label} claim`);
    validateText(item.sourceRef, `${label} sourceRef`);
    if (![
      'confirmed',
      'supported',
      'provisional',
      'unknown',
    ].includes(item.confidence)) throw new Error(`${label} confidence is invalid`);
  }
}

function validateHistory(value) {
  if (!Array.isArray(value) || value.length > 100) {
    throw new TypeError('eliminationAndReworkHistory must be an array');
  }
  const fields = [
    'reviewHash',
    'candidateId',
    'verdict',
    'failedCriteria',
    'hardVetoes',
    'correctionTargets',
    'affectedModuleIds',
    'requiresBusinessDecision',
    'blockedReason',
    'remainingRisks',
    'requestedBusinessInput',
    'roundId',
    'treatmentId',
    'validationVerdict',
  ];
  for (const [index, item] of value.entries()) {
    exactObject(item, fields, `eliminationAndReworkHistory[${index}]`);
    validateSha(item.reviewHash, 'history reviewHash');
    safeId(item.candidateId, 'history candidateId');
    if (!['rework', 'eliminated'].includes(item.verdict)) {
      throw new Error('history verdict is invalid');
    }
    for (const field of [
      'failedCriteria',
      'hardVetoes',
      'correctionTargets',
      'affectedModuleIds',
      'remainingRisks',
      'requestedBusinessInput',
    ]) validateTextArray(item[field], `history ${field}`);
    if (
      item.affectedModuleIds.length === 0
      || item.affectedModuleIds.some(
        (moduleId) => !Object.values(BRAND_SKILL_MODULES).flat().includes(moduleId),
      )
    ) throw new Error('history affectedModuleIds are invalid');
    if (typeof item.requiresBusinessDecision !== 'boolean') {
      throw new TypeError('history requiresBusinessDecision must be boolean');
    }
    if (item.blockedReason !== '') validateText(item.blockedReason, 'history blockedReason');
    for (const field of ['roundId', 'treatmentId', 'validationVerdict']) {
      if (item[field] !== null) validateText(item[field], `history ${field}`);
    }
  }
}

function projectTimeline(timeline) {
  return timeline.map((entry) => ({
    sequence: entry.sequence,
    at: entry.at,
    eventType: entry.eventType,
    fromStatus: entry.fromStatus,
    toStatus: entry.toStatus,
    eventHash: entry.eventHash,
    reviewHash: entry.reviewHash ?? null,
    candidateHash: entry.candidateHash ?? null,
    rootCauseFingerprint: entry.rootCauseFingerprint ?? null,
    roundId: entry.roundId ?? null,
  }));
}

function validateSha(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new TypeError(`${label} must be lowercase SHA-256`);
  }
}

function exactObject(value, fields, label) {
  assertPlain(value, label);
  rejectUnknown(value, fields, label);
  requireFields(value, fields, label);
}

function snapshotStableJson(value, label, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${label} is not stable JSON`);
    return value;
  }
  if (typeof value !== 'object') {
    throw new TypeError(`${label} is not stable JSON`);
  }
  if (utilTypes.isProxy(value)) throw new TypeError(`${label} must not be a Proxy`);
  if (ancestors.has(value)) throw new TypeError(`${label} contains a cycle`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new TypeError(`${label} contains symbol keys`);
      }
      const result = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (
          descriptor === undefined
          || descriptor.get !== undefined
          || descriptor.set !== undefined
        ) throw new TypeError(`${label} contains an accessor or sparse array`);
        result.push(snapshotStableJson(
          descriptor.value,
          `${label}[${index}]`,
          ancestors,
        ));
      }
      const allowed = new Set([
        'length',
        ...Array.from({ length: value.length }, (_, index) => String(index)),
      ]);
      if (Object.getOwnPropertyNames(value).some((key) => !allowed.has(key))) {
        throw new TypeError(`${label} array contains extra properties`);
      }
      return result;
    }
    assertPlain(value, label);
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError(`${label} contains symbol keys`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result = {};
    for (const key of Object.keys(value)) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined
        || descriptor.get !== undefined
        || descriptor.set !== undefined
        || descriptor.enumerable !== true
      ) throw new TypeError(`${label}.${key} must be an enumerable data field`);
      result[key] = snapshotStableJson(
        descriptor.value,
        `${label}.${key}`,
        ancestors,
      );
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function requireFields(value, fields, label) {
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) {
      throw new Error(`${label} is missing field: ${field}`);
    }
  }
}
