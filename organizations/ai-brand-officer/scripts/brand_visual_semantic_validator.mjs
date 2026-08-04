import { createHash } from 'node:crypto';
import {
  lstat,
  readFile,
  realpath,
} from 'node:fs/promises';
import path from 'node:path';
import {
  TextDecoder,
  types as utilTypes,
} from 'node:util';

import {
  assertPlain,
  rejectUnknown,
  safeId,
  stableSha256,
  stableStringify,
  validateTaskIdentity,
} from './brand_contracts.mjs';
import {
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
  'schemaVersion',
  'brandId',
  'selectedModuleIds',
  'directionCandidates',
  'pairwiseDifferenceEvidence',
  'aestheticProfileRef',
  'publicCapabilityHandoffs',
]);
const TRUSTED_FIELDS = Object.freeze([
  'plan',
  'projectRoot',
  'brandId',
  'visualPolicyContext',
]);
const POLICY_FIELDS = Object.freeze([
  'schemaVersion',
  'projectContextVersion',
  'commanderTaskId',
]);
const DIRECTION_FIELDS = Object.freeze([
  'directionId',
  'assetRef',
  'imageSha256',
]);
const ARTIFACT_FIELDS = Object.freeze([
  'artifactId',
  'version',
  'sha256',
  'sourceOrganizationId',
]);
const PROFILE_FIELDS = Object.freeze([
  'enterpriseId',
  'businessProjectId',
  'brandId',
  'artifactId',
  'version',
  'sha256',
  'importSnapshotRef',
]);
const PAIR_FIELDS = Object.freeze(['directionIds', 'dimensions']);
const HANDOFF_FIELDS = Object.freeze([
  'registryRef',
  'publicSkillId',
  'capabilityId',
  'maturity',
  'allowedOrganizations',
  'controllerTaskAuthorizationRef',
  'authorized',
  'decision',
]);
const REGISTRY_REF_FIELDS = Object.freeze([
  'path',
  'versionOrHash',
  'sha256',
  'readAt',
]);
const CONTROLLER_REF_FIELDS = Object.freeze([
  'enterpriseId',
  'businessProjectId',
  'taskId',
  'contextVersion',
  'projectFileSha256',
  'commanderTaskId',
]);
const DIRECTION_IDS = Object.freeze([
  'direction-01',
  'direction-02',
  'direction-03',
]);
const REQUIRED_PAIRS = Object.freeze([
  'direction-01|direction-02',
  'direction-01|direction-03',
  'direction-02|direction-03',
]);
const DIFFERENCE_DIMENSIONS = new Set([
  'composition',
  'crop',
  'lighting',
  'color',
  'typography',
  'material',
  'whitespace',
  'information-density',
  'graphic-language',
  'image-language',
]);
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_FILE_BYTES = 1024 * 1024;
const REGISTRY_RELATIVE_PATH = 'public-skills/registry.json';

export async function validateBrandVisualCandidate(
  candidateValue,
  trustedOptionsValue,
) {
  const trusted = normalizeTrustedOptions(trustedOptionsValue);
  const candidate = snapshot(candidateValue, 'brand visual candidate');
  validateBrandTaskPlan(trusted.plan);
  if (trusted.plan.skillId !== 'brand-visual') {
    throw new Error('brand visual semantic validator requires a brand-visual plan');
  }
  validateCandidateEnvelope(candidate, trusted.plan);
  validateVisualContent(candidate.content, trusted);
  const [registryRecord, projectRecord] = await Promise.all([
    readRegistryRecord(trusted.projectRoot),
    readProjectRecord(trusted.projectRoot, trusted.plan),
  ]);
  validatePolicyContext(trusted.visualPolicyContext, projectRecord.record);
  for (const [index, handoff] of candidate.content.publicCapabilityHandoffs.entries()) {
    validatePublicCapabilityHandoff(
      handoff,
      `publicCapabilityHandoffs[${index}]`,
      {
        candidate,
        trusted,
        registryRecord,
        projectRecord,
      },
    );
  }
  return deepFreeze(candidate);
}

function normalizeTrustedOptions(value) {
  if (utilTypes.isProxy(value)) {
    throw new TypeError('brand visual trusted options must not be a Proxy');
  }
  assertPlain(value, 'brand visual trusted options');
  rejectUnknown(value, TRUSTED_FIELDS, 'brand visual trusted options');
  requireFields(value, TRUSTED_FIELDS, 'brand visual trusted options');
  if (typeof value.projectRoot !== 'string' || !path.isAbsolute(value.projectRoot)) {
    throw new TypeError('brand visual trusted projectRoot must be absolute');
  }
  const brandId = safeId(value.brandId, 'brand visual trusted brandId');
  const policy = snapshot(value.visualPolicyContext, 'visualPolicyContext');
  assertPlain(policy, 'visualPolicyContext');
  rejectUnknown(policy, POLICY_FIELDS, 'visualPolicyContext');
  requireFields(policy, POLICY_FIELDS, 'visualPolicyContext');
  if (policy.schemaVersion !== 1) {
    throw new Error('visualPolicyContext schemaVersion must be 1');
  }
  if (
    !Number.isSafeInteger(policy.projectContextVersion)
    || policy.projectContextVersion < 1
  ) {
    throw new TypeError(
      'visualPolicyContext projectContextVersion must be a positive safe integer',
    );
  }
  safeId(policy.commanderTaskId, 'visualPolicyContext commanderTaskId');
  return {
    plan: snapshot(value.plan, 'brand visual trusted plan'),
    projectRoot: path.resolve(value.projectRoot),
    brandId,
    visualPolicyContext: policy,
  };
}

function validateCandidateEnvelope(candidate, plan) {
  assertPlain(candidate, 'brand visual candidate');
  rejectUnknown(candidate, CANDIDATE_FIELDS, 'brand visual candidate');
  requireFields(candidate, CANDIDATE_FIELDS, 'brand visual candidate');
  safeId(candidate.candidateId, 'brand visual candidateId');
  const identity = validateTaskIdentity({
    enterpriseId: candidate.enterpriseId,
    businessProjectId: candidate.businessProjectId,
    taskId: candidate.taskId,
  });
  for (const field of ['enterpriseId', 'businessProjectId', 'taskId']) {
    if (identity[field] !== plan[field]) {
      throw new Error(`brand visual candidate ${field} does not match plan`);
    }
  }
  if (candidate.skillId !== 'brand-visual') {
    throw new Error('brand visual candidate skillId must be brand-visual');
  }
  validateSha(candidate.candidateHash, 'brand visual candidateHash');
  const { candidateHash, ...withoutHash } = candidate;
  if (candidateHash !== stableSha256(withoutHash)) {
    throw new Error('brand visual candidateHash does not match candidate content');
  }
}

function validateVisualContent(content, trusted) {
  assertPlain(content, 'brand visual candidate content');
  rejectUnknown(content, CONTENT_FIELDS, 'brand visual candidate content');
  requireFields(content, CONTENT_FIELDS, 'brand visual candidate content');
  if (content.schemaVersion !== 1) {
    throw new Error('brand visual candidate content schemaVersion must be 1');
  }
  if (safeId(content.brandId, 'brand visual candidate brandId') !== trusted.brandId) {
    throw new Error('brand visual candidate brandId does not match trusted brandId');
  }
  if (
    !Array.isArray(content.selectedModuleIds)
    || stableStringify(content.selectedModuleIds)
      !== stableStringify(trusted.plan.selectedModuleIds)
  ) {
    throw new Error('brand visual selectedModuleIds do not match trusted plan');
  }
  validateDirections(content.directionCandidates);
  validatePairwiseDifferences(content.pairwiseDifferenceEvidence);
  validateAestheticProfile(content.aestheticProfileRef, trusted);
  if (
    !Array.isArray(content.publicCapabilityHandoffs)
    || content.publicCapabilityHandoffs.length > 10
  ) {
    throw new TypeError(
      'publicCapabilityHandoffs must be an array with at most 10 entries',
    );
  }
}

function validateDirections(value) {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error('directionCandidates must contain exactly three directions');
  }
  const ids = [];
  const assetHashes = new Set();
  for (const [index, direction] of value.entries()) {
    const label = `directionCandidates[${index}]`;
    assertPlain(direction, label);
    rejectUnknown(direction, DIRECTION_FIELDS, label);
    requireFields(direction, ['directionId'], label);
    if (!DIRECTION_IDS.includes(direction.directionId)) {
      throw new Error(`${label} directionId is invalid`);
    }
    ids.push(direction.directionId);
    const hasAsset = Object.hasOwn(direction, 'assetRef');
    const hasImage = Object.hasOwn(direction, 'imageSha256');
    if (hasAsset === hasImage) {
      throw new Error(`${label} requires exactly one assetRef or imageSha256`);
    }
    const visualHash = hasAsset
      ? validateArtifactRef(direction.assetRef, `${label}.assetRef`).sha256
      : validateSha(direction.imageSha256, `${label}.imageSha256`);
    if (assetHashes.has(visualHash)) {
      throw new Error('three visual directions must bind distinct unique assets');
    }
    assetHashes.add(visualHash);
  }
  if (stableStringify(ids) !== stableStringify(DIRECTION_IDS)) {
    throw new Error('directionCandidates must use direction-01 through direction-03 in order');
  }
}

function validatePairwiseDifferences(value) {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(
      'pairwiseDifferenceEvidence must cover exactly the three pairs',
    );
  }
  const pairs = new Set();
  for (const [index, evidence] of value.entries()) {
    const label = `pairwiseDifferenceEvidence[${index}]`;
    assertPlain(evidence, label);
    rejectUnknown(evidence, PAIR_FIELDS, label);
    requireFields(evidence, PAIR_FIELDS, label);
    if (
      !Array.isArray(evidence.directionIds)
      || evidence.directionIds.length !== 2
      || new Set(evidence.directionIds).size !== 2
      || evidence.directionIds.some((id) => !DIRECTION_IDS.includes(id))
    ) {
      throw new Error(`${label}.directionIds must contain two distinct directions`);
    }
    const pair = [...evidence.directionIds].sort().join('|');
    if (!REQUIRED_PAIRS.includes(pair) || pairs.has(pair)) {
      throw new Error(`${label} is a duplicate or invalid direction pair`);
    }
    pairs.add(pair);
    if (
      !Array.isArray(evidence.dimensions)
      || evidence.dimensions.length < 2
      || new Set(evidence.dimensions).size !== evidence.dimensions.length
      || evidence.dimensions.some((item) => !DIFFERENCE_DIMENSIONS.has(item))
    ) {
      throw new Error(
        `${label}.dimensions requires at least two distinct visual dimensions`,
      );
    }
  }
  if (REQUIRED_PAIRS.some((pair) => !pairs.has(pair))) {
    throw new Error('pairwiseDifferenceEvidence is missing one of the three pairs');
  }
}

function validateAestheticProfile(value, trusted) {
  if (value === null) return;
  assertPlain(value, 'aestheticProfileRef');
  rejectUnknown(value, PROFILE_FIELDS, 'aestheticProfileRef');
  requireFields(value, PROFILE_FIELDS, 'aestheticProfileRef');
  for (const field of [
    'enterpriseId',
    'businessProjectId',
    'brandId',
    'artifactId',
  ]) {
    safeId(value[field], `aestheticProfileRef ${field}`);
  }
  validateVersion(value.version, 'aestheticProfileRef version');
  validateSha(value.sha256, 'aestheticProfileRef sha256');
  const isCurrentProfile = (
    value.enterpriseId === trusted.plan.enterpriseId
    && value.businessProjectId === trusted.plan.businessProjectId
    && value.brandId === trusted.brandId
  );
  if (isCurrentProfile) {
    if (value.importSnapshotRef !== null) {
      throw new Error('current-project aesthetic profile must not claim an import snapshot');
    }
    return;
  }
  if (value.importSnapshotRef === null) {
    throw new Error(
      'cross-project aesthetic profile requires a fixed import snapshot',
    );
  }
  const snapshotRef = validateArtifactRef(
    value.importSnapshotRef,
    'aestheticProfileRef.importSnapshotRef',
  );
  if (
    snapshotRef.artifactId !== value.artifactId
    || snapshotRef.version !== value.version
    || snapshotRef.sha256 !== value.sha256
  ) {
    throw new Error('cross-project aesthetic profile does not match its import snapshot');
  }
  const authorized = trusted.plan.upstreamArtifacts.some(
    (artifact) => stableStringify(artifact) === stableStringify(snapshotRef),
  );
  if (!authorized) {
    throw new Error(
      'cross-project aesthetic profile import snapshot is not in trusted upstream authorization',
    );
  }
}

async function readRegistryRecord(projectRoot) {
  const target = path.resolve(projectRoot, ...REGISTRY_RELATIVE_PATH.split('/'));
  const bytes = await readTrustedRegularFile(
    projectRoot,
    target,
    'public skill registry',
  );
  const record = parseStrictJson(bytes, 'public skill registry');
  assertPlain(record, 'public skill registry');
  if (!Array.isArray(record.publicSkills)) {
    throw new Error('public skill registry publicSkills must be an array');
  }
  return {
    record,
    sha256: hashBytes(bytes),
  };
}

async function readProjectRecord(projectRoot, plan) {
  const target = path.resolve(
    projectRoot,
    'business-projects',
    plan.enterpriseId,
    plan.businessProjectId,
    'project.json',
  );
  const bytes = await readTrustedRegularFile(projectRoot, target, 'project.json');
  const record = parseStrictJson(bytes, 'project.json');
  assertPlain(record, 'project.json');
  if (
    record.enterpriseId !== plan.enterpriseId
    || record.businessProjectId !== plan.businessProjectId
  ) {
    throw new Error('project.json identity does not match brand visual task');
  }
  if (
    !Number.isSafeInteger(record.contextVersion)
    || record.contextVersion < 1
  ) {
    throw new Error('project.json contextVersion is invalid');
  }
  safeId(record.commanderTaskId, 'project.json commanderTaskId');
  if (
    !Array.isArray(record.publicSkillIds)
    || record.publicSkillIds.some((id) => typeof id !== 'string')
  ) {
    throw new Error('project.json publicSkillIds must be an array of ids');
  }
  return {
    record,
    sha256: hashBytes(bytes),
  };
}

function validatePolicyContext(policy, project) {
  if (policy.projectContextVersion !== project.contextVersion) {
    throw new Error(
      'visualPolicyContext projectContextVersion does not match project.json',
    );
  }
  if (policy.commanderTaskId !== project.commanderTaskId) {
    throw new Error(
      'visualPolicyContext commanderTaskId does not match project.json',
    );
  }
}

function validatePublicCapabilityHandoff(
  handoff,
  label,
  {
    candidate,
    trusted,
    registryRecord,
    projectRecord,
  },
) {
  assertPlain(handoff, label);
  rejectUnknown(handoff, HANDOFF_FIELDS, label);
  requireFields(handoff, HANDOFF_FIELDS, label);
  const registryRef = handoff.registryRef;
  assertPlain(registryRef, `${label}.registryRef`);
  rejectUnknown(registryRef, REGISTRY_REF_FIELDS, `${label}.registryRef`);
  requireFields(registryRef, REGISTRY_REF_FIELDS, `${label}.registryRef`);
  if (registryRef.path !== REGISTRY_RELATIVE_PATH) {
    throw new Error(`${label}.registryRef.path must reference the root registry`);
  }
  validateSha(registryRef.sha256, `${label}.registryRef.sha256`);
  if (registryRef.sha256 !== registryRecord.sha256) {
    throw new Error(`${label}.registryRef sha256 does not match trusted bytes`);
  }
  const expectedVersionOrHash = Object.hasOwn(registryRecord.record, 'version')
    ? String(registryRecord.record.version)
    : `sha256:${registryRecord.sha256}`;
  if (registryRef.versionOrHash !== expectedVersionOrHash) {
    throw new Error(`${label}.registryRef versionOrHash is stale`);
  }
  if (
    typeof registryRef.readAt !== 'string'
    || Number.isNaN(Date.parse(registryRef.readAt))
  ) {
    throw new Error(`${label}.registryRef.readAt must be a date-time`);
  }

  safeId(handoff.publicSkillId, `${label}.publicSkillId`);
  safeId(handoff.capabilityId, `${label}.capabilityId`);
  const entry = registryRecord.record.publicSkills.find(
    (item) => (
      item?.id === handoff.publicSkillId
      && item?.capabilityId === handoff.capabilityId
    ),
  );
  if (entry === undefined) {
    throw new Error(`${label} public skill is absent from the trusted registry`);
  }
  if (handoff.maturity !== entry.maturity) {
    throw new Error(`${label} maturity does not match the trusted registry`);
  }
  if (
    !Array.isArray(entry.allowedOrganizations)
    || stableStringify(handoff.allowedOrganizations)
      !== stableStringify(entry.allowedOrganizations)
  ) {
    throw new Error(
      `${label} allowedOrganizations do not match the trusted registry`,
    );
  }
  const registryAllows = (
    entry.maturity === 'operational'
    && entry.allowedOrganizations.includes('ai-brand-officer')
  );
  const projectAllows = projectRecord.record.publicSkillIds.includes(
    handoff.publicSkillId,
  );

  const controllerRef = handoff.controllerTaskAuthorizationRef;
  assertPlain(controllerRef, `${label}.controllerTaskAuthorizationRef`);
  rejectUnknown(
    controllerRef,
    CONTROLLER_REF_FIELDS,
    `${label}.controllerTaskAuthorizationRef`,
  );
  requireFields(
    controllerRef,
    CONTROLLER_REF_FIELDS,
    `${label}.controllerTaskAuthorizationRef`,
  );
  const expectedControllerRef = {
    enterpriseId: trusted.plan.enterpriseId,
    businessProjectId: trusted.plan.businessProjectId,
    taskId: trusted.plan.taskId,
    contextVersion: projectRecord.record.contextVersion,
    projectFileSha256: projectRecord.sha256,
    commanderTaskId: projectRecord.record.commanderTaskId,
  };
  if (stableStringify(controllerRef) !== stableStringify(expectedControllerRef)) {
    throw new Error(
      `${label} controller task authorization reference is not trusted`,
    );
  }
  if (
    !registryAllows
    || !projectAllows
    || trusted.visualPolicyContext.commanderTaskId
      !== projectRecord.record.commanderTaskId
  ) {
    throw new Error(
      `${label} lacks registry, organization, or project publicSkillIds authorization`,
    );
  }
  if (
    handoff.authorized !== true
    || handoff.decision !== 'allow-formal-execution'
  ) {
    throw new Error(`${label} authorized decision does not match trusted result`);
  }
  if (
    candidate.enterpriseId !== controllerRef.enterpriseId
    || candidate.businessProjectId !== controllerRef.businessProjectId
    || candidate.taskId !== controllerRef.taskId
  ) {
    throw new Error(`${label} controller authorization does not bind this candidate`);
  }
}

function validateArtifactRef(value, label) {
  assertPlain(value, label);
  rejectUnknown(value, ARTIFACT_FIELDS, label);
  requireFields(value, ARTIFACT_FIELDS, label);
  const normalized = {
    artifactId: safeId(value.artifactId, `${label}.artifactId`),
    version: validateVersion(value.version, `${label}.version`),
    sha256: validateSha(value.sha256, `${label}.sha256`),
    sourceOrganizationId: safeId(
      value.sourceOrganizationId,
      `${label}.sourceOrganizationId`,
    ),
  };
  return normalized;
}

async function readTrustedRegularFile(root, target, label) {
  const canonicalRoot = await realpath(root).catch(() => {
    throw new Error('brand visual projectRoot does not exist');
  });
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(canonicalRoot, resolvedTarget);
  if (
    relative === ''
    || relative.startsWith('..')
    || path.isAbsolute(relative)
  ) {
    throw new Error(`${label} is outside projectRoot`);
  }
  let cursor = canonicalRoot;
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    const info = await lstat(cursor).catch(() => {
      throw new Error(`${label} does not exist`);
    });
    if (info.isSymbolicLink()) {
      throw new Error(`${label} path must not contain symbolic links`);
    }
    if (cursor !== resolvedTarget && !info.isDirectory()) {
      throw new Error(`${label} parent must be a directory`);
    }
  }
  const targetInfo = await lstat(resolvedTarget);
  if (!targetInfo.isFile() || targetInfo.size > MAX_FILE_BYTES) {
    throw new Error(`${label} must be a regular file no larger than 1 MB`);
  }
  const canonicalTarget = await realpath(resolvedTarget);
  const canonicalRelative = path.relative(canonicalRoot, canonicalTarget);
  if (
    canonicalRelative.startsWith('..')
    || path.isAbsolute(canonicalRelative)
  ) {
    throw new Error(`${label} resolves outside projectRoot`);
  }
  const bytes = await readFile(canonicalTarget);
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new Error(`${label} must be no larger than 1 MB`);
  }
  return bytes;
}

function snapshot(value, label) {
  if (utilTypes.isProxy(value)) throw new TypeError(`${label} must not be a Proxy`);
  let text;
  try {
    text = JSON.stringify(value);
  } catch {
    throw new TypeError(`${label} must be JSON serializable`);
  }
  if (text === undefined || text.length > 4 * 1024 * 1024) {
    throw new TypeError(`${label} must be bounded JSON`);
  }
  return JSON.parse(text);
}

function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseStrictJson(bytes, label) {
  if (
    bytes.length >= 3
    && bytes[0] === 0xef
    && bytes[1] === 0xbb
    && bytes[2] === 0xbf
  ) {
    throw new Error(`${label} must not contain a BOM`);
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} must contain valid UTF-8`);
  }
  assertNoDuplicateJsonKeys(text, label);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} must contain valid JSON`);
  }
}

function assertNoDuplicateJsonKeys(text, label) {
  let index = 0;
  const whitespace = /\s/u;
  const skipWhitespace = () => {
    while (index < text.length && whitespace.test(text[index])) index += 1;
  };
  const parseStringToken = () => {
    if (text[index] !== '"') throw new Error(`${label} must contain valid JSON`);
    const start = index;
    index += 1;
    while (index < text.length) {
      const character = text[index];
      if (character === '"') {
        index += 1;
        try {
          return JSON.parse(text.slice(start, index));
        } catch {
          throw new Error(`${label} must contain valid JSON`);
        }
      }
      if (character === '\\') {
        index += 1;
        if (index >= text.length) {
          throw new Error(`${label} must contain valid JSON`);
        }
        if (text[index] === 'u') {
          const escape = text.slice(index + 1, index + 5);
          if (!/^[a-f0-9]{4}$/iu.test(escape)) {
            throw new Error(`${label} must contain valid JSON`);
          }
          index += 4;
        } else if (!'"\\/bfnrt'.includes(text[index])) {
          throw new Error(`${label} must contain valid JSON`);
        }
      } else if (character.codePointAt(0) < 0x20) {
        throw new Error(`${label} must contain valid JSON`);
      }
      index += 1;
    }
    throw new Error(`${label} must contain valid JSON`);
  };
  const parseValue = () => {
    skipWhitespace();
    const character = text[index];
    if (character === '{') {
      index += 1;
      skipWhitespace();
      const keys = new Set();
      if (text[index] === '}') {
        index += 1;
        return;
      }
      while (index < text.length) {
        const key = parseStringToken();
        if (keys.has(key)) {
          throw new Error(`${label} contains duplicate JSON key: ${key}`);
        }
        keys.add(key);
        skipWhitespace();
        if (text[index] !== ':') {
          throw new Error(`${label} must contain valid JSON`);
        }
        index += 1;
        parseValue();
        skipWhitespace();
        if (text[index] === '}') {
          index += 1;
          return;
        }
        if (text[index] !== ',') {
          throw new Error(`${label} must contain valid JSON`);
        }
        index += 1;
        skipWhitespace();
      }
      throw new Error(`${label} must contain valid JSON`);
    }
    if (character === '[') {
      index += 1;
      skipWhitespace();
      if (text[index] === ']') {
        index += 1;
        return;
      }
      while (index < text.length) {
        parseValue();
        skipWhitespace();
        if (text[index] === ']') {
          index += 1;
          return;
        }
        if (text[index] !== ',') {
          throw new Error(`${label} must contain valid JSON`);
        }
        index += 1;
      }
      throw new Error(`${label} must contain valid JSON`);
    }
    if (character === '"') {
      parseStringToken();
      return;
    }
    const rest = text.slice(index);
    const scalar = rest.match(
      /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u,
    )?.[0];
    if (scalar === undefined) throw new Error(`${label} must contain valid JSON`);
    index += scalar.length;
  };
  parseValue();
  skipWhitespace();
  if (index !== text.length) throw new Error(`${label} must contain valid JSON`);
}

function validateSha(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256`);
  }
  return value;
}

function validateVersion(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function requireFields(value, fields, label) {
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) {
      throw new Error(`${label} is missing field: ${field}`);
    }
  }
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
