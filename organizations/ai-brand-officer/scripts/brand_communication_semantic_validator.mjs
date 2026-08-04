import {
  types as utilTypes,
} from 'node:util';
import { createHash } from 'node:crypto';

import {
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
  assertCommunicationUpstreamPrerequisite,
  validateBrandTaskPlan,
} from './brand_task_planner.mjs';

const CANDIDATE_FIELDS = Object.freeze([
  'candidateId',
  'taskId',
  'enterpriseId',
  'businessProjectId',
  'skillId',
  'content',
  'candidateHash',
]);
const CONTENT_FIELDS = Object.freeze([
  'messageHierarchy',
  'contentPillars',
  'proofLibrary',
  'brandStory',
  'founderIpPosition',
  'campaignMotherIdea',
  'toneAndVoice',
  'forbiddenClaims',
  'visualBindings',
  'channelAdaptationBoundary',
]);
const TRUSTED_FIELDS = Object.freeze([
  'plan',
  'evidenceBundle',
  'evidenceTrustedOptions',
]);
const ARTIFACT_FIELDS = Object.freeze([
  'artifactId',
  'version',
  'sha256',
  'sourceOrganizationId',
]);
const MESSAGE_FIELDS = Object.freeze([
  'coreMessage',
  'supportMessages',
  'trustReasons',
]);
const PILLAR_FIELDS = Object.freeze([
  'pillarId',
  'title',
  'purpose',
  'claimKey',
  'claimDigest',
  'evidenceIds',
  'status',
]);
const PROOF_FIELDS = Object.freeze([
  'proofId',
  'claimKey',
  'claim',
  'claimDigest',
  'evidenceIds',
  'status',
]);
const STORY_FIELDS = Object.freeze([
  'status',
  'narrative',
  'claims',
]);
const FOUNDER_FIELDS = Object.freeze([
  'status',
  'position',
  'viewpointBoundaries',
  'claims',
]);
const CAMPAIGN_FIELDS = Object.freeze([
  'status',
  'theme',
  'idea',
  'factualClaims',
]);
const CLAIM_FIELDS = Object.freeze([
  'claimKey',
  'claim',
  'claimDigest',
  'evidenceIds',
  'status',
]);
const TONE_FIELDS = Object.freeze([
  'principles',
  'preferredTerms',
  'forbiddenTerms',
]);
const VISUAL_FIELDS = Object.freeze([
  'status',
  'artifactRefs',
]);
const BOUNDARY_FIELDS = Object.freeze([
  'brandOfficer',
  'growthStrategist',
  'dealOfficer',
]);
const ASSERTION_STATUSES = new Set([
  'confirmed',
  'provisional',
  'unknown',
  'not-applicable',
]);
const PROOF_STATUSES = new Set([
  'confirmed',
  'provisional',
  'unknown',
]);
const FACTUAL_EVIDENCE_CATEGORIES = new Set([
  'upstream-artifact',
  'feishu',
  'conversation',
  'public-web',
]);
const FACTUAL_CONFIDENCES = new Set([
  'confirmed',
  'supported',
]);
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_SNAPSHOT_NODES = 50_000;
const MAX_ARRAY_LENGTH = 1_000;
const MAX_CONTENT_BYTES = 1024 * 1024;
const MAX_TEXT_LENGTH = 4_000;

export async function validateBrandCommunicationCandidate(
  candidateValue,
  trustedOptionsValue,
) {
  const trusted = normalizeTrustedOptions(trustedOptionsValue);
  const candidate = snapshot(candidateValue, 'brand communication candidate');
  validateBrandTaskPlan(trusted.plan);
  if (trusted.plan.skillId !== 'brand-communication') {
    throw new Error(
      'brand communication semantic validator requires a brand-communication plan',
    );
  }
  const upstream = assertCommunicationUpstreamPrerequisite({
    skillId: trusted.plan.skillId,
    selectedModuleIds: trusted.plan.selectedModuleIds,
    upstreamArtifacts: trusted.plan.upstreamArtifacts,
  });
  await validateBrandEvidenceBundle(
    trusted.evidenceBundle,
    trusted.evidenceTrustedOptions,
  );
  assertEvidenceBindings(trusted.plan, trusted.evidenceBundle);
  validateCandidateEnvelope(candidate, trusted.plan);
  validateCommunicationContent(
    candidate.content,
    trusted.evidenceBundle,
    upstream,
  );
  return deepFreeze(candidate);
}

function normalizeTrustedOptions(value) {
  if (utilTypes.isProxy(value)) {
    throw new TypeError(
      'brand communication trusted options must not be a Proxy',
    );
  }
  assertPlain(value, 'brand communication trusted options');
  rejectUnknown(
    value,
    TRUSTED_FIELDS,
    'brand communication trusted options',
  );
  requireFields(
    value,
    TRUSTED_FIELDS,
    'brand communication trusted options',
  );
  return {
    plan: snapshot(value.plan, 'brand communication trusted plan'),
    evidenceBundle: snapshot(
      value.evidenceBundle,
      'brand communication trusted evidence bundle',
    ),
    evidenceTrustedOptions: value.evidenceTrustedOptions,
  };
}

function assertEvidenceBindings(plan, evidenceBundle) {
  if (
    evidenceBundle.skillId !== plan.skillId
    || evidenceBundle.taskIdentity.enterpriseId !== plan.enterpriseId
    || evidenceBundle.taskIdentity.businessProjectId !== plan.businessProjectId
    || evidenceBundle.taskIdentity.taskId !== plan.taskId
  ) {
    throw new Error(
      'brand communication evidence bundle does not match the trusted plan',
    );
  }
  if (
    stableStringify(evidenceBundle.upstreamArtifacts)
    !== stableStringify(plan.upstreamArtifacts)
  ) {
    throw new Error(
      'brand communication plan and evidence upstream artifacts do not match',
    );
  }
}

function validateCandidateEnvelope(candidate, plan) {
  assertPlain(candidate, 'brand communication candidate');
  rejectUnknown(
    candidate,
    CANDIDATE_FIELDS,
    'brand communication candidate',
  );
  requireFields(
    candidate,
    CANDIDATE_FIELDS,
    'brand communication candidate',
  );
  safeId(candidate.candidateId, 'brand communication candidateId');
  const identity = validateTaskIdentity({
    enterpriseId: candidate.enterpriseId,
    businessProjectId: candidate.businessProjectId,
    taskId: candidate.taskId,
  });
  for (const field of ['enterpriseId', 'businessProjectId', 'taskId']) {
    if (identity[field] !== plan[field]) {
      throw new Error(
        `brand communication candidate ${field} does not match plan`,
      );
    }
  }
  if (candidate.skillId !== 'brand-communication') {
    throw new Error(
      'brand communication candidate skillId must be brand-communication',
    );
  }
  validateSha(candidate.candidateHash, 'brand communication candidateHash');
  const { candidateHash, ...withoutHash } = candidate;
  if (candidateHash !== stableSha256(withoutHash)) {
    throw new Error(
      'brand communication candidateHash does not match candidate content',
    );
  }
}

function validateCommunicationContent(content, evidenceBundle, upstream) {
  assertPlain(content, 'brand communication candidate content');
  rejectUnknown(
    content,
    CONTENT_FIELDS,
    'brand communication candidate content',
  );
  requireFields(
    content,
    CONTENT_FIELDS,
    'brand communication candidate content',
  );
  if (
    Buffer.byteLength(stableStringify(content), 'utf8')
    > MAX_CONTENT_BYTES
  ) {
    throw new Error(
      'brand communication candidate content exceeds the 1 MiB budget',
    );
  }
  const evidenceById = new Map(
    evidenceBundle.entries.map((entry) => [entry.evidenceId, entry]),
  );
  const evidenceClaimUsage = new Map();
  validateMessageHierarchy(
    content.messageHierarchy,
    evidenceById,
    evidenceClaimUsage,
  );
  validateContentPillars(
    content.contentPillars,
    evidenceById,
    evidenceClaimUsage,
  );
  validateProofLibrary(
    content.proofLibrary,
    evidenceById,
    evidenceClaimUsage,
  );
  validateStory(
    content.brandStory,
    evidenceById,
    evidenceClaimUsage,
  );
  validateFounder(
    content.founderIpPosition,
    evidenceById,
    evidenceClaimUsage,
  );
  validateCampaign(
    content.campaignMotherIdea,
    evidenceById,
    evidenceClaimUsage,
  );
  validateTone(content.toneAndVoice);
  validateTextArray(
    content.forbiddenClaims,
    'forbiddenClaims',
    { minimum: 1, maximum: 100 },
  );
  validateVisualBindings(content.visualBindings, upstream);
  validateChannelBoundary(content.channelAdaptationBoundary);
}

function validateMessageHierarchy(
  value,
  evidenceById,
  evidenceClaimUsage,
) {
  exactObject(value, MESSAGE_FIELDS, 'messageHierarchy');
  validateClaimObject(
    value.coreMessage,
    'messageHierarchy.coreMessage',
    evidenceById,
    evidenceClaimUsage,
  );
  validateClaimArray(
    value.supportMessages,
    'messageHierarchy.supportMessages',
    evidenceById,
    evidenceClaimUsage,
    { minimum: 1, maximum: 20 },
  );
  validateClaimArray(
    value.trustReasons,
    'messageHierarchy.trustReasons',
    evidenceById,
    evidenceClaimUsage,
    { minimum: 1, maximum: 20 },
  );
}

function validateContentPillars(value, evidenceById, evidenceClaimUsage) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new Error('contentPillars must contain 1-20 pillars');
  }
  const ids = new Set();
  for (const [index, pillar] of value.entries()) {
    const label = `contentPillars[${index}]`;
    exactObject(pillar, PILLAR_FIELDS, label);
    const pillarId = safeId(pillar.pillarId, `${label}.pillarId`);
    if (ids.has(pillarId)) {
      throw new Error(`contentPillars has duplicate pillarId: ${pillarId}`);
    }
    ids.add(pillarId);
    validateText(pillar.title, `${label}.title`);
    validateClaimText(pillar.purpose, `${label}.purpose`);
    validateClaimEvidenceBinding(
      pillar,
      label,
      evidenceById,
      evidenceClaimUsage,
      pillar.purpose,
    );
  }
}

function validateProofLibrary(value, evidenceById, evidenceClaimUsage) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new Error('proofLibrary must contain 1-100 proofs');
  }
  const ids = new Set();
  for (const [index, proof] of value.entries()) {
    const label = `proofLibrary[${index}]`;
    exactObject(proof, PROOF_FIELDS, label);
    const proofId = safeId(proof.proofId, `${label}.proofId`);
    if (ids.has(proofId)) {
      throw new Error(`proofLibrary has duplicate proofId: ${proofId}`);
    }
    ids.add(proofId);
    validateClaimText(proof.claim, `${label}.claim`);
    validateClaimEvidenceBinding(
      proof,
      label,
      evidenceById,
      evidenceClaimUsage,
      proof.claim,
    );
  }
}

function validateStory(value, evidenceById, evidenceClaimUsage) {
  exactObject(value, STORY_FIELDS, 'brandStory');
  validateAssertionStatus(value.status, 'brandStory.status');
  validateText(value.narrative, 'brandStory.narrative');
  validateClaimArray(
    value.claims,
    'brandStory.claims',
    evidenceById,
    evidenceClaimUsage,
    {
      minimum: value.status === 'confirmed' ? 1 : 0,
      maximum: 50,
    },
  );
  assertConfirmedContainerClaims(
    value.status,
    value.claims,
    'brandStory',
  );
}

function validateFounder(value, evidenceById, evidenceClaimUsage) {
  exactObject(value, FOUNDER_FIELDS, 'founderIpPosition');
  validateAssertionStatus(
    value.status,
    'founderIpPosition.status',
  );
  validateText(value.position, 'founderIpPosition.position');
  validateTextArray(
    value.viewpointBoundaries,
    'founderIpPosition.viewpointBoundaries',
    { minimum: 1, maximum: 20 },
  );
  validateClaimArray(
    value.claims,
    'founderIpPosition.claims',
    evidenceById,
    evidenceClaimUsage,
    {
      minimum: value.status === 'confirmed' ? 1 : 0,
      maximum: 50,
    },
  );
  assertConfirmedContainerClaims(
    value.status,
    value.claims,
    'founderIpPosition',
  );
}

function validateCampaign(value, evidenceById, evidenceClaimUsage) {
  exactObject(value, CAMPAIGN_FIELDS, 'campaignMotherIdea');
  validateAssertionStatus(value.status, 'campaignMotherIdea.status');
  validateText(value.theme, 'campaignMotherIdea.theme');
  validateText(value.idea, 'campaignMotherIdea.idea');
  validateClaimArray(
    value.factualClaims,
    'campaignMotherIdea.factualClaims',
    evidenceById,
    evidenceClaimUsage,
    {
      minimum: value.status === 'confirmed' ? 1 : 0,
      maximum: 50,
    },
  );
  assertConfirmedContainerClaims(
    value.status,
    value.factualClaims,
    'campaignMotherIdea',
  );
}

function validateTone(value) {
  exactObject(value, TONE_FIELDS, 'toneAndVoice');
  validateTextArray(
    value.principles,
    'toneAndVoice.principles',
    { minimum: 1, maximum: 20 },
  );
  validateTextArray(
    value.preferredTerms,
    'toneAndVoice.preferredTerms',
    { minimum: 1, maximum: 100 },
  );
  validateTextArray(
    value.forbiddenTerms,
    'toneAndVoice.forbiddenTerms',
    { minimum: 1, maximum: 100 },
  );
}

function validateClaimArray(
  value,
  label,
  evidenceById,
  evidenceClaimUsage,
  { minimum, maximum },
) {
  if (
    !Array.isArray(value)
    || value.length < minimum
    || value.length > maximum
  ) {
    throw new Error(
      `${label} must contain ${minimum}-${maximum} claim items`,
    );
  }
  value.forEach((item, index) => validateClaimObject(
    item,
    `${label}[${index}]`,
    evidenceById,
    evidenceClaimUsage,
  ));
}

function validateClaimObject(
  value,
  label,
  evidenceById,
  evidenceClaimUsage,
) {
  exactObject(value, CLAIM_FIELDS, label);
  validateClaimText(value.claim, `${label}.claim`);
  validateClaimEvidenceBinding(
    value,
    label,
    evidenceById,
    evidenceClaimUsage,
    value.claim,
  );
}

function validateClaimEvidenceBinding(
  value,
  label,
  evidenceById,
  evidenceClaimUsage,
  factualClaimText,
) {
  const claimKey = safeId(value.claimKey, `${label}.claimKey`);
  const claimDigest = validateOptionalClaimDigest(
    value.claimDigest,
    `${label}.claimDigest`,
  );
  if (!PROOF_STATUSES.has(value.status)) {
    throw new Error(`${label}.status is invalid`);
  }
  const referencedEvidence = validateEvidenceIds(
    value.evidenceIds,
    `${label}.evidenceIds`,
    evidenceById,
    evidenceClaimUsage,
    {
      claimKey,
      confirmed: value.status === 'confirmed',
    },
  );
  const candidateComputedDigest = digestNormalizedClaim(
    factualClaimText,
    `${label}.claim`,
  );
  if (value.status === 'confirmed' && claimDigest === null) {
    throw new Error(
      `${label}.claimDigest is required for a confirmed claim`,
    );
  }
  if (
    claimDigest !== null
    && candidateComputedDigest !== claimDigest
  ) {
    throw new Error(
      `${label}.claimDigest does not match the normalized candidate claim`,
    );
  }
  if (
    value.status === 'confirmed'
    && referencedEvidence.some((evidence) => (
      digestNormalizedClaim(
        evidence.claim,
        `${label} evidence claim`,
      ) !== claimDigest
    ))
  ) {
    throw new Error(
      `${label}.claimDigest does not match every normalized referenced evidence claim`,
    );
  }
}

function validateEvidenceIds(
  value,
  label,
  evidenceById,
  evidenceClaimUsage,
  { claimKey, confirmed },
) {
  if (
    !Array.isArray(value)
    || value.length > 100
    || new Set(value).size !== value.length
  ) {
    throw new Error(`${label} must contain unique evidence ids`);
  }
  if (confirmed && value.length === 0) {
    throw new Error(
      `${label} requires evidence when status is confirmed`,
    );
  }
  for (const [index, evidenceId] of value.entries()) {
    safeId(evidenceId, `${label}[${index}]`);
    const evidence = evidenceById.get(evidenceId);
    if (evidence === undefined) {
      throw new Error(`${label} references unknown evidenceId: ${evidenceId}`);
    }
    const priorClaimKey = evidenceClaimUsage.get(evidenceId);
    if (priorClaimKey !== undefined && priorClaimKey !== claimKey) {
      throw new Error(
        `${label} reuses evidenceId ${evidenceId} across different claimKey values`,
      );
    }
    evidenceClaimUsage.set(evidenceId, claimKey);
    if (
      confirmed
      && (
        evidence.claimKey === undefined
        || evidence.claimKey !== claimKey
        || !FACTUAL_EVIDENCE_CATEGORIES.has(evidence.category)
        || !FACTUAL_CONFIDENCES.has(evidence.confidence)
      )
    ) {
      throw new Error(
        `${label} confirmed claim requires exact matching evidence claimKey and factual supported evidence`,
      );
    }
  }
  return value.map((evidenceId) => evidenceById.get(evidenceId));
}

function assertConfirmedContainerClaims(status, claims, label) {
  if (
    status === 'confirmed'
    && claims.some((claim) => claim.status !== 'confirmed')
  ) {
    throw new Error(
      `${label} confirmed status requires every factual claim to be confirmed`,
    );
  }
}

function validateVisualBindings(value, upstream) {
  exactObject(value, VISUAL_FIELDS, 'visualBindings');
  if (!['bound', 'not-applicable', 'pending'].includes(value.status)) {
    throw new Error('visualBindings.status is invalid');
  }
  if (!Array.isArray(value.artifactRefs) || value.artifactRefs.length > 10) {
    throw new Error('visualBindings.artifactRefs must contain at most 10 refs');
  }
  const refs = value.artifactRefs.map((artifact, index) => (
    validateArtifactRef(artifact, `visualBindings.artifactRefs[${index}]`)
  ));
  if (upstream.visualStatus === 'bound') {
    if (
      value.status !== 'bound'
      || refs.length !== 1
      || stableStringify(refs[0])
        !== stableStringify(upstream.visualArtifact)
    ) {
      throw new Error(
        'visualBindings must bind the exact trusted brand-visual artifact',
      );
    }
  } else if (
    value.status === 'bound'
    || refs.length !== 0
  ) {
    throw new Error(
      'visualBindings must be not-applicable or pending without a fake artifact',
    );
  }
}

function validateChannelBoundary(value) {
  exactObject(
    value,
    BOUNDARY_FIELDS,
    'channelAdaptationBoundary',
  );
  for (const field of BOUNDARY_FIELDS) {
    validateText(
      value[field],
      `channelAdaptationBoundary.${field}`,
    );
  }
  const brandRequired = [
    'AI品牌官',
    '品牌信息母体',
    '内容母题',
    '原则',
    '证据',
    '禁区',
  ];
  const brandForbidden = [
    '小红书日更',
    '小红书种草',
    '短视频日更',
    '公众号日常',
    '私域运营',
    '投流获客',
    '成交话术',
    '成交脚本',
    '成交策略',
  ];
  if (
    brandRequired.some((term) => !value.brandOfficer.includes(term))
    || brandForbidden.some((term) => value.brandOfficer.includes(term))
  ) {
    throw new Error(
      'channelAdaptationBoundary.brandOfficer cannot own daily growth or sales execution',
    );
  }
  const growthRequired = [
    'AI增长战略官',
    '小红书',
    '短视频',
    '公众号',
    '私域',
    '选题',
    '节奏',
    '运营',
    '获客',
  ];
  if (growthRequired.some(
    (term) => !value.growthStrategist.includes(term),
  )) {
    throw new Error(
      'channelAdaptationBoundary.growthStrategist is incomplete',
    );
  }
  const dealRequired = [
    'AI成交官',
    '销售沟通',
    '成交话术',
    '成交脚本',
    '成交策略',
  ];
  if (dealRequired.some((term) => !value.dealOfficer.includes(term))) {
    throw new Error(
      'channelAdaptationBoundary.dealOfficer is incomplete',
    );
  }
}

function validateAssertionStatus(value, label) {
  if (!ASSERTION_STATUSES.has(value)) {
    throw new Error(`${label} is invalid`);
  }
}

function validateArtifactRef(value, label) {
  exactObject(value, ARTIFACT_FIELDS, label);
  const result = {
    artifactId: safeId(value.artifactId, `${label}.artifactId`),
    version: value.version,
    sha256: validateSha(value.sha256, `${label}.sha256`),
    sourceOrganizationId: safeId(
      value.sourceOrganizationId,
      `${label}.sourceOrganizationId`,
    ),
  };
  if (!Number.isSafeInteger(result.version) || result.version < 1) {
    throw new Error(`${label}.version must be a positive safe integer`);
  }
  return result;
}

function validateTextArray(value, label, { minimum, maximum }) {
  if (
    !Array.isArray(value)
    || value.length < minimum
    || value.length > maximum
    || new Set(value).size !== value.length
  ) {
    throw new Error(
      `${label} must contain ${minimum}-${maximum} unique text items`,
    );
  }
  value.forEach((item, index) => (
    validateText(item, `${label}[${index}]`)
  ));
}

function validateText(value, label) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.length > MAX_TEXT_LENGTH
  ) {
    throw new Error(`${label} must be normalized non-empty text`);
  }
}

function validateClaimText(value, label) {
  if (
    typeof value !== 'string'
    || value.length > MAX_TEXT_LENGTH
    || normalizeClaimText(value).length === 0
  ) {
    throw new Error(`${label} must be non-empty claim text`);
  }
}

function normalizeClaimText(value) {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

function digestNormalizedClaim(value, label) {
  validateClaimText(value, label);
  return createHash('sha256')
    .update(normalizeClaimText(value), 'utf8')
    .digest('hex');
}

function validateOptionalClaimDigest(value, label) {
  if (value === null) return null;
  return validateSha(value, label);
}

function validateSha(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new Error(`${label} must be lowercase SHA-256`);
  }
  return value;
}

function exactObject(value, fields, label) {
  assertPlain(value, label);
  rejectUnknown(value, fields, label);
  requireFields(value, fields, label);
}

function requireFields(value, fields, label) {
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) {
      throw new Error(`${label} is missing field: ${field}`);
    }
  }
}

function snapshot(value, label) {
  const budget = { nodes: 0 };
  const result = snapshotNode(value, label, new Set(), budget);
  if (
    Buffer.byteLength(stableStringify(result), 'utf8')
    > MAX_CONTENT_BYTES * 4
  ) {
    throw new Error(`${label} exceeds the 4 MiB snapshot budget`);
  }
  return result;
}

function snapshotNode(value, label, ancestors, budget) {
  budget.nodes += 1;
  if (budget.nodes > MAX_SNAPSHOT_NODES) {
    throw new Error(`${label} exceeds the node budget`);
  }
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${label} is not stable JSON`);
    }
    return value;
  }
  if (typeof value !== 'object' || utilTypes.isProxy(value)) {
    throw new TypeError(`${label} must be stable JSON and not a Proxy`);
  }
  if (ancestors.has(value)) {
    throw new TypeError(`${label} contains a cycle`);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY_LENGTH) {
        throw new Error(`${label} exceeds the array budget`);
      }
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const result = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (
          descriptor === undefined
          || descriptor.get !== undefined
          || descriptor.set !== undefined
        ) throw new TypeError(`${label} contains an accessor or sparse array`);
        result.push(snapshotNode(
          descriptor.value,
          `${label}[${index}]`,
          ancestors,
          budget,
        ));
      }
      return result;
    }
    assertPlain(value, label);
    if (Object.getOwnPropertySymbols(value).length !== 0) {
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
      ) throw new TypeError(`${label}.${key} must be a data field`);
      result[key] = snapshotNode(
        descriptor.value,
        `${label}.${key}`,
        ancestors,
        budget,
      );
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function deepFreeze(value) {
  if (
    value === null
    || typeof value !== 'object'
    || Object.isFrozen(value)
  ) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
