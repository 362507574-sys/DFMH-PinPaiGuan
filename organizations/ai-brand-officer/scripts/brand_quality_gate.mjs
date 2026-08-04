import {
  types as utilTypes,
} from 'node:util';

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
  validateBrandEvidenceBundle,
} from './brand_evidence_engine.mjs';
import {
  validateBrandTaskPlan,
} from './brand_task_planner.mjs';

export const POSTER_HARD_VETOES = Object.freeze([
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

export const POSTER_DIMENSION_WEIGHTS = Object.freeze({
  brandStrategy: 20,
  visualAesthetics: 25,
  informationEfficiency: 20,
  brandConsistency: 15,
  craftQuality: 10,
  channelFitness: 10,
});

export const POSTER_COMPARISON_CHECK_IDS = Object.freeze([
  'three-second-recognition',
  'thumbnail',
  'grayscale',
  'same-size-side-by-side',
  'hide-text',
  'text-only-hierarchy',
  'reference-dna-and-brand-product-match',
]);

const REQUEST_FIELDS = Object.freeze([
  'ruleReview',
  'professionalReview',
]);
const TRUSTED_OPTIONS_FIELDS = Object.freeze([
  'plan',
  'evidenceBundle',
  'evidenceTrustedOptions',
  'candidate',
  'reviewerBindings',
]);
const REVIEWER_BINDING_FIELDS = Object.freeze([
  'ruleReviewerId',
  'professionalReviewerId',
]);
const CANDIDATE_FIELDS = Object.freeze([
  'candidateId',
  'taskId',
  'enterpriseId',
  'businessProjectId',
  'skillId',
  'content',
  'candidateHash',
]);
const RULE_REVIEW_FIELDS = Object.freeze([
  'reviewId',
  'reviewerId',
  'reviewerRole',
  'passed',
  'failedCriteria',
  'hardVetoes',
]);
const PROFESSIONAL_REVIEW_FIELDS = Object.freeze([
  'reviewId',
  'reviewerId',
  'reviewerRole',
  'passed',
  'score',
  'observations',
  'correctionTargets',
]);
const REVIEW_FIELDS = Object.freeze([
  'verdict',
  'score',
  'hardVetoes',
  'failedCriteria',
  'correctionTargets',
  'reviewTrace',
  'candidateId',
  'taskIdentity',
  'skillId',
  'planHash',
  'evidenceHash',
  'candidateHash',
  'reviewHash',
]);
const POSTER_INPUT_FIELDS = Object.freeze([
  'candidateId',
  'hardVetoes',
  'dimensions',
  'comparisonChecks',
]);
const COMPARISON_FIELDS = Object.freeze([
  'checkId',
  'passed',
  'observation',
]);
const VERDICTS = new Set([
  'preferred',
  'candidate_ready',
  'rework',
  'eliminated',
]);
const HARD_VETO_INDEX = new Map(
  POSTER_HARD_VETOES.map((value, index) => [value, index]),
);
const COMPARISON_INDEX = new Map(
  POSTER_COMPARISON_CHECK_IDS.map((value, index) => [value, index]),
);
const SHA256 = /^[a-f0-9]{64}$/u;
const DECIMAL_SCORE = /^(?:0|[1-9]\d*)(?:\.(\d{1,3}))?$/u;
const MAX_TEXT_LENGTH = 2000;
const MAX_LIST_ITEMS = 100;
const MAX_JSON_DEPTH = 50;
const MAX_OBJECT_PROPERTIES = 200;
const MAX_ARRAY_LENGTH = 10_000;
const MAX_TOTAL_ITEMS = 20_000;
const MAX_TOTAL_NODES = 30_000;
const MAX_JSON_BYTES = 1024 * 1024;

/**
 * Business request contains only the two independently produced reviews.
 * All identity, evidence, candidate and reviewer authorization inputs are
 * injected through trustedOptions by the control center/runtime.
 */
export async function evaluateBrandCandidate(requestInput, trustedOptions) {
  const request = normalizeRequest(requestInput);
  const trusted = await normalizeTrustedOptions(trustedOptions);
  const review = buildTrustedReview({
    trusted,
    ruleReview: request.ruleReview,
    professionalReview: request.professionalReview,
  });
  await validateBrandCandidateReview(review, trustedOptions);
  return deepFreeze(review);
}

/**
 * Replays the two reviews against freshly revalidated trusted context.
 * reviewHash is only a deterministic content fingerprint, never a signature.
 */
export async function validateBrandCandidateReview(
  reviewInput,
  trustedOptions,
) {
  const trusted = await normalizeTrustedOptions(trustedOptions);
  const review = snapshotStableJson(reviewInput, 'brand candidate review');
  assertPlain(review, 'brand candidate review');
  rejectUnknown(review, REVIEW_FIELDS, 'brand candidate review');
  requireFields(review, REVIEW_FIELDS, 'brand candidate review');

  if (!VERDICTS.has(review.verdict)) {
    throw new Error('brand candidate review verdict is invalid');
  }
  scoreToMillis(review.score, 100, 'brand candidate review score');
  validateHardVetoes(review.hardVetoes);
  validateStringList(
    review.failedCriteria,
    'brand candidate review failedCriteria',
    { allowEmpty: true, sort: true },
  );
  validateStringList(
    review.correctionTargets,
    'brand candidate review correctionTargets',
    { allowEmpty: true, sort: true },
  );
  safeId(review.candidateId, 'brand candidate review candidateId');
  validateTaskIdentity(review.taskIdentity);
  validateSkillId(review.skillId, 'brand candidate review skillId');
  validateSha256(review.planHash, 'brand candidate review planHash');
  validateSha256(review.evidenceHash, 'brand candidate review evidenceHash');
  validateSha256(review.candidateHash, 'brand candidate review candidateHash');
  validateSha256(review.reviewHash, 'brand candidate review reviewHash');

  if (!Array.isArray(review.reviewTrace) || review.reviewTrace.length !== 2) {
    throw new Error('brand candidate review reviewTrace must contain two reviews');
  }
  if (
    review.reviewTrace[0]?.reviewerRole !== 'rule-engine'
    || review.reviewTrace[1]?.reviewerRole
      !== 'brand-professional-reviewer'
  ) {
    throw new Error(
      'brand candidate review reviewTrace role order is not canonical',
    );
  }
  const ruleReview = validateRuleReview(
    review.reviewTrace[0],
    trusted.reviewerBindings,
  );
  const professionalReview = validateProfessionalReview(
    review.reviewTrace[1],
    trusted.reviewerBindings,
  );
  validateIndependentReviews(ruleReview, professionalReview);
  const expected = buildTrustedReview({
    trusted,
    ruleReview,
    professionalReview,
  });
  const { reviewHash, ...reviewWithoutHash } = review;
  const { reviewHash: expectedHash, ...expectedWithoutHash } = expected;
  if (stableStringify(reviewWithoutHash) !== stableStringify(expectedWithoutHash)) {
    throw new Error(
      'brand candidate review does not match canonical trusted review',
    );
  }
  if (reviewHash !== stableSha256(reviewWithoutHash)) {
    throw new Error('brand candidate review reviewHash does not match contents');
  }
  if (reviewHash !== expectedHash) {
    throw new Error('brand candidate review reviewHash is not canonical');
  }
  return true;
}

/**
 * Poster scoring remains a synchronous, standalone visual scoring helper.
 * It does not claim reviewer authenticity or replace the trusted generic gate.
 */
export function scorePosterCandidate(input) {
  const snapshot = snapshotStableJson(input, 'poster review input');
  assertPlain(snapshot, 'poster review input');
  rejectUnknown(snapshot, POSTER_INPUT_FIELDS, 'poster review input');
  requireFields(snapshot, POSTER_INPUT_FIELDS, 'poster review input');

  const candidateId = safeId(snapshot.candidateId, 'candidateId');
  const hardVetoes = validateHardVetoes(snapshot.hardVetoes);
  const dimensions = validatePosterDimensions(snapshot.dimensions);
  const comparisonChecks = validateComparisonChecks(
    snapshot.comparisonChecks,
  );
  const scoreMillis = Object.values(dimensions)
    .reduce((sum, value) => sum + value, 0);
  const score = scoreMillis / 1000;
  const failedChecks = comparisonChecks.filter((check) => !check.passed);
  const professionalFailedCriteria = [
    ...failedChecks.map((check) => check.checkId),
    ...(scoreMillis < 80_000 ? ['poster-score-below-80'] : []),
  ];
  const ruleCorrections = hardVetoes.map(
    (veto) => `消除硬否决：${veto}`,
  );
  const professionalCorrections = [
    ...failedChecks.map(
      (check) => `修正对比检查 ${check.checkId}：${check.observation}`,
    ),
    ...(scoreMillis < 80_000
      ? [`海报总分由 ${score} 提升至至少 80 分。`]
      : []),
  ];
  const reviewTrace = [
    {
      reviewerRole: 'rule-engine',
      passed: hardVetoes.length === 0,
      score: hardVetoes.length === 0 ? 100 : 0,
      observations: hardVetoes.length === 0
        ? ['十项硬否决检查通过。']
        : [`命中硬否决：${hardVetoes.join('；')}`],
      failedCriteria: [...hardVetoes],
      correctionTargets: ruleCorrections,
      hardVetoes: [...hardVetoes],
    },
    {
      reviewerRole: 'brand-professional-reviewer',
      passed: scoreMillis >= 80_000 && failedChecks.length === 0,
      score,
      observations: comparisonChecks.map(
        (check) => `${check.checkId}：${check.observation}`,
      ),
      failedCriteria: professionalFailedCriteria,
      correctionTargets: professionalCorrections,
      hardVetoes: [],
    },
  ];
  const failedCriteria = uniqueCanonical([
    ...reviewTrace[0].failedCriteria,
    ...reviewTrace[1].failedCriteria,
  ]);
  const correctionTargets = uniqueCanonical([
    ...ruleCorrections,
    ...professionalCorrections,
  ]);
  const verdict = deriveVerdict({
    scoreMillis,
    hardVetoes,
    evidenceBlocked: false,
    rulePassed: reviewTrace[0].passed,
    professionalPassed: reviewTrace[1].passed,
  });
  const withoutHash = {
    verdict,
    score,
    hardVetoes,
    failedCriteria,
    correctionTargets,
    reviewTrace,
    candidateId,
    skillId: 'brand-visual',
  };
  return deepFreeze({
    ...withoutHash,
    reviewHash: stableSha256(withoutHash),
  });
}

function normalizeRequest(input) {
  const request = snapshotStableJson(input, 'brand review request');
  assertPlain(request, 'brand review request');
  rejectUnknown(request, REQUEST_FIELDS, 'brand review request');
  requireFields(request, REQUEST_FIELDS, 'brand review request');
  return {
    ruleReview: request.ruleReview,
    professionalReview: request.professionalReview,
  };
}

async function normalizeTrustedOptions(input) {
  if (input === undefined) {
    throw new Error('trusted options are required');
  }
  const options = snapshotStableJson(input, 'trusted options');
  assertPlain(options, 'trusted options');
  rejectUnknown(options, TRUSTED_OPTIONS_FIELDS, 'trusted options');
  requireFields(options, TRUSTED_OPTIONS_FIELDS, 'trusted options');

  validateBrandTaskPlan(options.plan);
  await validateBrandEvidenceBundle(
    options.evidenceBundle,
    options.evidenceTrustedOptions,
  );
  const identity = {
    enterpriseId: options.plan.enterpriseId,
    businessProjectId: options.plan.businessProjectId,
    taskId: options.plan.taskId,
  };
  validateEvidenceBinding(
    options.evidenceBundle,
    identity,
    options.plan.skillId,
  );
  const candidate = validateCandidate(
    options.candidate,
    identity,
    options.plan.skillId,
  );
  const reviewerBindings = validateReviewerBindings(
    options.reviewerBindings,
  );
  return {
    plan: options.plan,
    evidenceBundle: options.evidenceBundle,
    candidate,
    reviewerBindings,
    taskIdentity: identity,
  };
}

function validateEvidenceBinding(evidenceBundle, identity, skillId) {
  assertPlain(evidenceBundle, 'evidence bundle');
  const evidenceIdentity = validateTaskIdentity(evidenceBundle.taskIdentity);
  for (const field of ['enterpriseId', 'businessProjectId', 'taskId']) {
    if (evidenceIdentity[field] !== identity[field]) {
      throw new Error(`evidence bundle ${field} must match plan`);
    }
  }
  validateSkillId(evidenceBundle.skillId, 'evidence bundle skillId');
  if (evidenceBundle.skillId !== skillId) {
    throw new Error('evidence bundle skillId must match plan');
  }
}

function validateCandidate(candidate, identity, skillId) {
  assertPlain(candidate, 'candidate');
  rejectUnknown(candidate, CANDIDATE_FIELDS, 'candidate');
  requireFields(candidate, CANDIDATE_FIELDS, 'candidate');
  const candidateId = safeId(candidate.candidateId, 'candidate candidateId');
  for (const field of ['enterpriseId', 'businessProjectId', 'taskId']) {
    safeId(candidate[field], `candidate ${field}`);
    if (candidate[field] !== identity[field]) {
      throw new Error(`candidate ${field} must match plan`);
    }
  }
  validateSkillId(candidate.skillId, 'candidate skillId');
  if (candidate.skillId !== skillId) {
    throw new Error('candidate skillId must match plan');
  }
  assertPlain(candidate.content, 'candidate content');
  if (Reflect.ownKeys(candidate.content).length === 0) {
    throw new Error('candidate content must be a non-empty safe JSON object');
  }
  validateSha256(candidate.candidateHash, 'candidate candidateHash');
  const withoutHash = {
    candidateId,
    taskId: candidate.taskId,
    enterpriseId: candidate.enterpriseId,
    businessProjectId: candidate.businessProjectId,
    skillId: candidate.skillId,
    content: candidate.content,
  };
  if (candidate.candidateHash !== stableSha256(withoutHash)) {
    throw new Error('candidate candidateHash does not match content');
  }
  return {
    ...withoutHash,
    candidateHash: candidate.candidateHash,
  };
}

function validateReviewerBindings(bindings) {
  assertPlain(bindings, 'reviewer bindings');
  rejectUnknown(
    bindings,
    REVIEWER_BINDING_FIELDS,
    'reviewer bindings',
  );
  requireFields(
    bindings,
    REVIEWER_BINDING_FIELDS,
    'reviewer bindings',
  );
  const ruleReviewerId = safeId(
    bindings.ruleReviewerId,
    'reviewer bindings ruleReviewerId',
  );
  const professionalReviewerId = safeId(
    bindings.professionalReviewerId,
    'reviewer bindings professionalReviewerId',
  );
  if (ruleReviewerId === professionalReviewerId) {
    throw new Error('reviewer bindings must use different reviewer IDs');
  }
  return { ruleReviewerId, professionalReviewerId };
}

function validateRuleReview(review, reviewerBindings) {
  assertPlain(review, 'rule review');
  rejectUnknown(review, RULE_REVIEW_FIELDS, 'rule review');
  requireFields(
    review,
    [
      'reviewId',
      'reviewerId',
      'reviewerRole',
      'passed',
      'failedCriteria',
    ],
    'rule review',
  );
  const reviewId = safeId(review.reviewId, 'rule review reviewId');
  const reviewerId = safeId(review.reviewerId, 'rule review reviewerId');
  if (reviewerId !== reviewerBindings.ruleReviewerId) {
    throw new Error('rule review reviewerId does not match trusted binding');
  }
  if (review.reviewerRole !== 'rule-engine') {
    throw new Error('rule review reviewerRole must be rule-engine');
  }
  if (typeof review.passed !== 'boolean') {
    throw new TypeError('rule review passed must be boolean');
  }
  const failedCriteria = validateStringList(
    review.failedCriteria,
    'rule review failedCriteria',
    { allowEmpty: true, sort: true },
  );
  const hardVetoes = validateHardVetoes(review.hardVetoes ?? []);
  if (
    review.passed
    && (failedCriteria.length > 0 || hardVetoes.length > 0)
  ) {
    throw new Error(
      'rule review passed cannot contradict failedCriteria or hardVetoes',
    );
  }
  if (!review.passed && failedCriteria.length === 0 && hardVetoes.length === 0) {
    throw new Error('failed rule review requires failedCriteria or hardVetoes');
  }
  return {
    reviewId,
    reviewerId,
    reviewerRole: 'rule-engine',
    passed: review.passed,
    failedCriteria,
    hardVetoes,
  };
}

function validateProfessionalReview(review, reviewerBindings) {
  assertPlain(review, 'professional review');
  rejectUnknown(
    review,
    PROFESSIONAL_REVIEW_FIELDS,
    'professional review',
  );
  requireFields(
    review,
    PROFESSIONAL_REVIEW_FIELDS,
    'professional review',
  );
  const reviewId = safeId(
    review.reviewId,
    'professional review reviewId',
  );
  const reviewerId = safeId(
    review.reviewerId,
    'professional review reviewerId',
  );
  if (reviewerId !== reviewerBindings.professionalReviewerId) {
    throw new Error(
      'professional review reviewerId does not match trusted binding',
    );
  }
  if (review.reviewerRole !== 'brand-professional-reviewer') {
    throw new Error(
      'professional reviewer role must be brand-professional-reviewer',
    );
  }
  if (typeof review.passed !== 'boolean') {
    throw new TypeError('professional review passed must be boolean');
  }
  const scoreMillis = scoreToMillis(
    review.score,
    100,
    'professional review score',
  );
  const observations = validateStringList(
    review.observations,
    'professional review observations',
    { allowEmpty: false, sort: false },
  );
  const correctionTargets = validateStringList(
    review.correctionTargets,
    'professional review correctionTargets',
    { allowEmpty: review.passed, sort: true },
  );
  return {
    reviewId,
    reviewerId,
    reviewerRole: 'brand-professional-reviewer',
    passed: review.passed,
    score: scoreMillis / 1000,
    observations,
    correctionTargets,
  };
}

function validateIndependentReviews(ruleReview, professionalReview) {
  if (ruleReview.reviewId === professionalReview.reviewId) {
    throw new Error('independent reviewId values must be different');
  }
  if (ruleReview.reviewerId === professionalReview.reviewerId) {
    throw new Error('independent reviewerId values must be different');
  }
}

function buildTrustedReview({
  trusted,
  ruleReview: ruleInput,
  professionalReview: professionalInput,
}) {
  const ruleReview = validateRuleReview(
    ruleInput,
    trusted.reviewerBindings,
  );
  const professionalReview = validateProfessionalReview(
    professionalInput,
    trusted.reviewerBindings,
  );
  validateIndependentReviews(ruleReview, professionalReview);
  const scoreMillis = scoreToMillis(
    professionalReview.score,
    100,
    'professional review score',
  );
  const ruleCorrections = [
    ...ruleReview.failedCriteria.map(
      (criterion) => `修正规则项：${criterion}`,
    ),
    ...ruleReview.hardVetoes.map(
      (veto) => `消除硬否决：${veto}`,
    ),
  ];
  const professionalFailedCriteria = professionalReview.passed
    ? []
    : ['professional-review-failed'];
  const evidenceFailedCriteria = trusted.evidenceBundle.blocked
    ? ['evidence-blocked']
    : [];
  const failedCriteria = uniqueCanonical([
    ...ruleReview.failedCriteria,
    ...ruleReview.hardVetoes,
    ...professionalFailedCriteria,
    ...evidenceFailedCriteria,
  ]);
  const correctionTargets = uniqueCanonical([
    ...ruleCorrections,
    ...professionalReview.correctionTargets,
  ]);
  const reviewTrace = [
    ruleReview,
    professionalReview,
  ];
  const verdict = deriveVerdict({
    scoreMillis,
    hardVetoes: ruleReview.hardVetoes,
    evidenceBlocked: trusted.evidenceBundle.blocked,
    rulePassed: ruleReview.passed,
    professionalPassed: professionalReview.passed,
  });
  const withoutHash = {
    verdict,
    score: scoreMillis / 1000,
    hardVetoes: ruleReview.hardVetoes,
    failedCriteria,
    correctionTargets,
    reviewTrace,
    candidateId: trusted.candidate.candidateId,
    taskIdentity: { ...trusted.taskIdentity },
    skillId: trusted.plan.skillId,
    planHash: trusted.plan.planHash,
    evidenceHash: trusted.evidenceBundle.evidenceHash,
    candidateHash: trusted.candidate.candidateHash,
  };
  return {
    ...withoutHash,
    reviewHash: stableSha256(withoutHash),
  };
}

function deriveVerdict({
  scoreMillis,
  hardVetoes,
  evidenceBlocked,
  rulePassed,
  professionalPassed,
}) {
  if (hardVetoes.length > 0 || evidenceBlocked) return 'eliminated';
  if (scoreMillis < 70_000) return 'eliminated';
  if (!rulePassed || !professionalPassed) return 'rework';
  if (scoreMillis < 80_000) return 'rework';
  if (scoreMillis < 90_000) return 'candidate_ready';
  return 'preferred';
}

function validateHardVetoes(values) {
  if (!Array.isArray(values) || values.length > POSTER_HARD_VETOES.length) {
    throw new TypeError('hardVetoes must be an array of fixed hard veto codes');
  }
  const seen = new Set();
  const normalized = values.map((veto) => {
    if (typeof veto !== 'string' || !HARD_VETO_INDEX.has(veto)) {
      throw new Error(`unknown hard veto: ${String(veto)}`);
    }
    if (seen.has(veto)) {
      throw new Error(`duplicate hard veto: ${veto}`);
    }
    seen.add(veto);
    return veto;
  });
  return normalized.sort(
    (first, second) => (
      HARD_VETO_INDEX.get(first) - HARD_VETO_INDEX.get(second)
    ),
  );
}

function validatePosterDimensions(dimensions) {
  assertPlain(dimensions, 'poster dimensions');
  const dimensionIds = Object.keys(POSTER_DIMENSION_WEIGHTS);
  rejectUnknown(dimensions, dimensionIds, 'poster dimensions');
  requireFields(dimensions, dimensionIds, 'poster dimensions');
  return Object.fromEntries(dimensionIds.map((dimensionId) => [
    dimensionId,
    scoreToMillis(
      dimensions[dimensionId],
      POSTER_DIMENSION_WEIGHTS[dimensionId],
      dimensionId,
    ),
  ]));
}

function validateComparisonChecks(checks) {
  if (!Array.isArray(checks) || checks.length !== 7) {
    throw new Error('all seven comparison checks are mandatory');
  }
  const seen = new Set();
  const normalized = checks.map((check, index) => {
    const label = `comparison check at index ${index}`;
    assertPlain(check, label);
    rejectUnknown(check, COMPARISON_FIELDS, label);
    requireFields(check, COMPARISON_FIELDS, label);
    if (typeof check.checkId !== 'string' || !COMPARISON_INDEX.has(check.checkId)) {
      throw new Error(`unknown comparison check: ${String(check.checkId)}`);
    }
    if (seen.has(check.checkId)) {
      throw new Error(`duplicate comparison check: ${check.checkId}`);
    }
    seen.add(check.checkId);
    if (typeof check.passed !== 'boolean') {
      throw new TypeError(`${label} passed must be boolean`);
    }
    return {
      checkId: check.checkId,
      passed: check.passed,
      observation: validateReadableText(
        check.observation,
        `${label} observation`,
      ),
    };
  });
  if (POSTER_COMPARISON_CHECK_IDS.some((checkId) => !seen.has(checkId))) {
    throw new Error('all seven comparison checks are mandatory exactly once');
  }
  return normalized.sort(
    (first, second) => (
      COMPARISON_INDEX.get(first.checkId)
      - COMPARISON_INDEX.get(second.checkId)
    ),
  );
}

function scoreToMillis(value, maximum, label) {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < 0
    || value > maximum
  ) {
    throw new TypeError(
      `${label} must be a finite number between 0 and ${maximum}`,
    );
  }
  const text = String(value);
  const match = DECIMAL_SCORE.exec(text);
  if (!match) {
    throw new TypeError(`${label} must use at most 3 decimal places`);
  }
  const [integerText, fraction = ''] = text.split('.');
  const millis = Number(integerText) * 1000
    + Number(fraction.padEnd(3, '0') || '0');
  if (!Number.isSafeInteger(millis) || millis > maximum * 1000) {
    throw new TypeError(`${label} is outside its exact score range`);
  }
  return millis;
}

function validateStringList(
  values,
  label,
  { allowEmpty, sort },
) {
  if (
    !Array.isArray(values)
    || values.length > MAX_LIST_ITEMS
    || (!allowEmpty && values.length === 0)
  ) {
    throw new TypeError(`${label} must be a ${allowEmpty ? '' : 'non-empty '}array`);
  }
  const seen = new Set();
  const normalized = values.map((value, index) => {
    const text = validateReadableText(value, `${label} at index ${index}`);
    if (seen.has(text)) {
      throw new Error(`${label} contains duplicate entries`);
    }
    seen.add(text);
    return text;
  });
  return sort ? normalized.sort(compareStrings) : normalized;
}

function validateReadableText(value, label) {
  if (
    typeof value !== 'string'
    || value.trim().length === 0
    || value.length > MAX_TEXT_LENGTH
  ) {
    throw new TypeError(
      `${label} must be readable text of at most ${MAX_TEXT_LENGTH} characters`,
    );
  }
  return value.trim();
}

function validateSkillId(value, label) {
  if (typeof value !== 'string' || !Object.hasOwn(BRAND_SKILL_MODULES, value)) {
    throw new Error(`${label} must be a registered skill`);
  }
  return value;
}

function validateSha256(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new TypeError(`${label} must be lowercase SHA-256`);
  }
}

function requireFields(value, fields, label) {
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) {
      throw new Error(`${label} is missing field: ${field}`);
    }
  }
}

function compareStrings(first, second) {
  return first < second ? -1 : first > second ? 1 : 0;
}

function uniqueCanonical(values) {
  return [...new Set(values)].sort(compareStrings);
}

function snapshotStableJson(value, label) {
  const state = {
    items: 0,
    nodes: 0,
    bytes: 0,
  };
  return cloneStableJson(value, label, 0, new Set(), state);
}

function cloneStableJson(value, label, depth, ancestors, state) {
  state.nodes += 1;
  if (state.nodes > MAX_TOTAL_NODES) {
    throw new TypeError(`${label} exceeds JSON resource limit`);
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    state.bytes += Buffer.byteLength(value, 'utf8');
    checkBytes(label, state);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${label} must contain only finite JSON numbers`);
    }
    return value;
  }
  if (typeof value !== 'object') {
    throw new TypeError(`${label} must contain only stable JSON values`);
  }
  if (utilTypes.isProxy(value)) {
    throw new TypeError(`${label} Proxy values are unsupported`);
  }
  if (depth > MAX_JSON_DEPTH) {
    throw new TypeError(`${label} exceeds maximum JSON depth`);
  }
  if (ancestors.has(value)) {
    throw new TypeError(`${label} contains a circular reference`);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      assertDataDescriptor(lengthDescriptor, `${label}.length`);
      const length = lengthDescriptor.value;
      if (
        length > MAX_ARRAY_LENGTH
        || state.items + length > MAX_TOTAL_ITEMS
      ) {
        throw new TypeError(`${label} array exceeds JSON resource limit`);
      }
      const keys = Reflect.ownKeys(value);
      if (keys.some((key) => typeof key === 'symbol')) {
        throw new TypeError(`${label} array contains symbol keys`);
      }
      let indexCount = 0;
      for (const key of keys) {
        if (key === 'length') continue;
        if (!/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= length) {
          throw new TypeError(`${label} array contains extra properties`);
        }
        indexCount += 1;
      }
      if (indexCount !== length) {
        throw new TypeError(`${label} sparse arrays are unsupported`);
      }
      state.items += length;
      const clone = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        assertDataDescriptor(descriptor, `${label}[${index}]`);
        clone.push(cloneStableJson(
          descriptor.value,
          `${label}[${index}]`,
          depth + 1,
          ancestors,
          state,
        ));
      }
      return clone;
    }

    assertPlain(value, label);
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key === 'symbol')) {
      throw new TypeError(`${label} contains symbol keys`);
    }
    if (
      keys.length > MAX_OBJECT_PROPERTIES
      || state.items + keys.length > MAX_TOTAL_ITEMS
    ) {
      throw new TypeError(`${label} object exceeds JSON resource limit`);
    }
    state.items += keys.length;
    const clone = {};
    for (const key of keys) {
      state.bytes += Buffer.byteLength(key, 'utf8');
      checkBytes(label, state);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      assertDataDescriptor(descriptor, `${label}.${key}`);
      if (!descriptor.enumerable) {
        throw new TypeError(`${label}.${key} must be enumerable`);
      }
      clone[key] = cloneStableJson(
        descriptor.value,
        `${label}.${key}`,
        depth + 1,
        ancestors,
        state,
      );
    }
    return clone;
  } finally {
    ancestors.delete(value);
  }
}

function assertDataDescriptor(descriptor, label) {
  if (!descriptor) {
    throw new TypeError(`${label} is missing from stable JSON`);
  }
  if (
    typeof descriptor.get === 'function'
    || typeof descriptor.set === 'function'
  ) {
    throw new TypeError(`${label} accessor properties are unsupported`);
  }
}

function checkBytes(label, state) {
  if (state.bytes > MAX_JSON_BYTES) {
    throw new TypeError(`${label} exceeds JSON byte resource limit`);
  }
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}
