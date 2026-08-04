import { createHash } from 'node:crypto';
import {
  lstat,
  readFile,
  realpath,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import {
  TextDecoder,
  types as utilTypes,
} from 'node:util';

import {
  createKnowledgeContext,
} from '../../../scripts/feishu-commander/knowledge_context.mjs';
import {
  BRAND_SKILL_MODULES,
  assertPlain,
  rejectUnknown,
  safeId,
  stableSha256,
  stableStringify,
  validateTaskIdentity,
} from './brand_contracts.mjs';

const REQUEST_FIELDS = Object.freeze([
  'taskIdentity',
  'skillId',
  'conversationFacts',
  'publicSources',
  'professionalJudgments',
  'requestedUpstreamArtifacts',
  'criticalUnknowns',
]);
const TRUSTED_OPTIONS_FIELDS = Object.freeze([
  'projectRoot',
  'projectContext',
  'receiptBinding',
]);
const PROJECT_CONTEXT_FIELDS = Object.freeze([
  'schemaVersion',
  'taskId',
  'enterpriseId',
  'businessProjectId',
  'projectContextVersion',
  'readableArtifacts',
]);
const ARTIFACT_FIELDS = Object.freeze([
  'artifactId',
  'version',
  'sha256',
  'sourceOrganizationId',
]);
const LOCATOR_FIELDS = Object.freeze(['receiptPath', 'receiptSha256']);
const RECEIPT_FIELDS = Object.freeze([
  'schemaVersion',
  'requestId',
  'generatedAt',
  'status',
  'taskSummary',
  'capabilityId',
  'spaces',
  'queries',
  'sources',
  'unreadCandidates',
  'degradedReason',
]);
const SPACE_FIELDS = Object.freeze(['name', 'spaceId']);
const SOURCE_FIELDS = Object.freeze([
  'spaceName',
  'title',
  'url',
  'token',
  'docType',
  'excerpt',
]);
const UNREAD_FIELDS = Object.freeze(['title', 'reason']);
const PREFLIGHT_FIELDS = Object.freeze([
  'receiptPath',
  'receiptSha256',
  'requestId',
  'generatedAt',
  'status',
  'spaces',
  'queries',
  'sources',
  'degradedReason',
]);
const EVIDENCE_INPUT_FIELDS = Object.freeze([
  'id',
  'claim',
  'sourceRef',
  'confidence',
  'claimKey',
]);
const PUBLIC_INPUT_FIELDS = Object.freeze([
  'id',
  'claim',
  'url',
  'confidence',
  'claimKey',
]);
const PROFESSIONAL_INPUT_FIELDS = Object.freeze([
  'id',
  'category',
  'claim',
  'sourceRef',
  'confidence',
  'claimKey',
]);
const CRITICAL_UNKNOWN_FIELDS = Object.freeze([
  'id',
  'criticalField',
  'description',
  'sourceRef',
]);
const AUTHORIZATION_FIELDS = Object.freeze([
  'projectContextVersion',
  'readableArtifactsHash',
]);
const BUNDLE_FIELDS = Object.freeze([
  'schemaVersion',
  'taskIdentity',
  'skillId',
  'sourceOrder',
  'feishuPreflight',
  'authorizationContext',
  'upstreamArtifacts',
  'criticalUnknowns',
  'entries',
  'conflicts',
  'limitations',
  'blocked',
  'evidenceHash',
]);
const ENTRY_FIELDS = Object.freeze([
  'evidenceId',
  'category',
  'claim',
  'sourceRef',
  'confidence',
  'claimKey',
]);
const CONFLICT_FIELDS = Object.freeze([
  'conflictId',
  'claimKey',
  'evidenceIds',
  'claims',
  'resolutionStatus',
]);

const SHA256 = /^[a-f0-9]{64}$/u;
const WINDOWS_DEVICE_SEGMENT =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const FEISHU_TOKEN = /^[A-Za-z0-9_-]{8,512}$/u;
const SOURCE_ORDER = Object.freeze(['feishu', 'conversation', 'public-web']);
const DEFAULT_FEISHU_SPACES = Object.freeze([
  '老雷知识库',
  '老雷课件知识库',
]);
const FORMAL_FEISHU_STATUSES = new Set(['matched', 'no_hit', 'degraded']);
const CATEGORY_ORDER = Object.freeze([
  'upstream-artifact',
  'feishu',
  'conversation',
  'public-web',
  'professional-judgment',
  'inference',
  'assumption',
  'unknown',
]);
const EVIDENCE_CATEGORIES = new Set(CATEGORY_ORDER);
const CONFIDENCE_VALUES = new Set([
  'confirmed',
  'supported',
  'provisional',
  'unknown',
]);
const PROFESSIONAL_CATEGORIES = new Set([
  'professional-judgment',
  'inference',
  'assumption',
  'unknown',
]);
const CRITICAL_FIELDS = new Set([
  'product-category',
  'primary-audience',
  'product-fidelity',
  'human-identity',
  'legal-field',
]);
const LIMITATION_ORDER = Object.freeze([
  'feishu-no-hit',
  'feishu-degraded',
  'critical-unknowns',
]);
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_JSON_DEPTH = 32;
const MAX_OBJECT_PROPERTIES = 100;
const MAX_ARRAY_ITEMS = 1000;
const MAX_TOTAL_NODES = 20_000;
const MAX_TOTAL_ITEMS = 20_000;
const MAX_ARTIFACTS = 100;
const MAX_INPUT_EVIDENCE = 500;
const MAX_CONFLICTS = 100;
const MAX_CLAIM_CODE_POINTS = 10_000;
const MAX_SOURCE_REF_CODE_POINTS = 2_000;
const CRITICAL_CLAIM_KEY = /^critical-[a-f0-9]{24}$/u;

/**
 * trustedOptions is injected by the control center/runtime. Ordinary callers
 * must never populate it from fields reported in the business request.
 */
export async function buildBrandEvidenceBundle(input, trustedOptions) {
  const request = snapshotStableJson(input, 'brand evidence request');
  assertPlain(request, 'brand evidence request');
  rejectUnknown(request, REQUEST_FIELDS, 'brand evidence request');
  requireFields(request, [
    'taskIdentity',
    'skillId',
    'conversationFacts',
    'publicSources',
    'professionalJudgments',
  ], 'brand evidence request');

  const taskIdentity = validateTaskIdentity(request.taskIdentity);
  const skillId = validateSkillId(
    request.skillId,
    'brand evidence request skillId',
  );
  const trusted = normalizeTrustedOptions(
    trustedOptions,
    taskIdentity,
  );
  const feishuPreflight = await readKnowledgeReceipt({
    projectRoot: trusted.projectRoot,
    locator: trusted.receiptBinding,
    taskIdentity,
  });
  const upstreamArtifacts = bindAuthorizedArtifacts(
    trusted.projectContext.readableArtifacts,
    request.requestedUpstreamArtifacts,
  );
  const criticalRecords = normalizeCriticalUnknowns(
    request.criticalUnknowns ?? [],
  );
  const criticalUnknowns = criticalRecords
    .map(({ criticalUnknown }) => criticalUnknown)
    .sort(compareCriticalUnknowns);
  const entries = [
    ...upstreamArtifacts.map(artifactEvidenceEntry),
    ...feishuEntries(feishuPreflight.sources),
    ...normalizeEvidenceArray(
      request.conversationFacts,
      'conversationFacts',
      'conversation',
      EVIDENCE_INPUT_FIELDS,
    ),
    ...normalizePublicSources(request.publicSources),
    ...normalizeProfessionalJudgments(request.professionalJudgments),
    ...criticalRecords.map(({ entry }) => entry),
  ].sort(compareEntries);
  ensureUniqueEvidenceIds(entries);
  const conflicts = buildConflicts(entries);
  const limitations = deriveLimitations(
    feishuPreflight.status,
    criticalUnknowns.length,
  );
  const withoutHash = {
    schemaVersion: 1,
    taskIdentity: {
      enterpriseId: taskIdentity.enterpriseId,
      businessProjectId: taskIdentity.businessProjectId,
      taskId: taskIdentity.taskId,
    },
    skillId,
    sourceOrder: [...SOURCE_ORDER],
    feishuPreflight,
    authorizationContext: {
      projectContextVersion: trusted.projectContext.projectContextVersion,
      readableArtifactsHash: stableSha256(
        trusted.projectContext.readableArtifacts,
      ),
    },
    upstreamArtifacts,
    criticalUnknowns,
    entries,
    conflicts,
    limitations,
    blocked: criticalUnknowns.length > 0,
  };
  const bundle = {
    ...withoutHash,
    evidenceHash: stableSha256(withoutHash),
  };
  await validateBrandEvidenceBundle(bundle, trusted);
  return deepFreeze(bundle);
}

/**
 * trustedOptions is injected by the control center/runtime. Validation always
 * re-reads the bound receipt and never trusts Feishu data embedded in bundle.
 */
export async function validateBrandEvidenceBundle(value, trustedOptions) {
  const bundle = snapshotStableJson(value, 'brand evidence bundle');
  assertPlain(bundle, 'brand evidence bundle');
  rejectUnknown(bundle, BUNDLE_FIELDS, 'brand evidence bundle');
  requireFields(bundle, BUNDLE_FIELDS, 'brand evidence bundle');
  if (bundle.schemaVersion !== 1) {
    throw new Error('brand evidence bundle schemaVersion must be 1');
  }
  const taskIdentity = validateTaskIdentity(bundle.taskIdentity);
  validateSkillId(bundle.skillId, 'brand evidence bundle skillId');
  const trusted = normalizeTrustedOptions(
    trustedOptions,
    taskIdentity,
  );
  const projectContext = trusted.projectContext;
  const trustedPreflight = await readKnowledgeReceipt({
    projectRoot: trusted.projectRoot,
    locator: trusted.receiptBinding,
    taskIdentity,
  });
  if (!sameArray(bundle.sourceOrder, SOURCE_ORDER)) {
    throw new Error(
      'brand evidence bundle sourceOrder must be feishu, conversation, public-web',
    );
  }
  const authorizationContext = validateAuthorizationContext(
    bundle.authorizationContext,
  );
  if (
    authorizationContext.projectContextVersion
    !== projectContext.projectContextVersion
  ) {
    throw new Error(
      'project context version does not match authorizationContext',
    );
  }
  if (
    authorizationContext.readableArtifactsHash
    !== stableSha256(projectContext.readableArtifacts)
  ) {
    throw new Error(
      'readable artifacts hash does not match authorizationContext',
    );
  }
  const upstreamArtifacts = normalizeArtifacts(
    bundle.upstreamArtifacts,
    'upstreamArtifacts',
  );
  assertCanonical(
    bundle.upstreamArtifacts,
    upstreamArtifacts,
    'upstreamArtifacts',
  );
  assertArtifactsAuthorized(
    projectContext.readableArtifacts,
    upstreamArtifacts,
  );
  const preflight = validatePreflightOutput(bundle.feishuPreflight);
  if (preflight.requestId !== taskIdentity.taskId) {
    throw new Error('knowledge receipt requestId does not match task identity');
  }
  if (stableStringify(preflight) !== stableStringify(trustedPreflight)) {
    throw new Error(
      'bundle feishuPreflight does not match trusted knowledge receipt',
    );
  }
  const criticalRecords = normalizeCriticalUnknowns(bundle.criticalUnknowns);
  const criticalUnknowns = criticalRecords
    .map(({ criticalUnknown }) => criticalUnknown)
    .sort(compareCriticalUnknowns);
  assertCanonical(
    bundle.criticalUnknowns,
    criticalUnknowns,
    'criticalUnknowns',
  );
  const entries = validateBundleEntries(bundle.entries);
  const sortedEntries = [...entries].sort(compareEntries);
  validateFeishuEntrySemantics(preflight.sources, entries);
  validateArtifactEntrySemantics(upstreamArtifacts, entries);
  validateCriticalEntrySemantics(criticalRecords, entries);
  assertCanonical(bundle.entries, sortedEntries, 'entries');
  validateConflicts(bundle.conflicts, entries);
  const expectedLimitations = deriveLimitations(
    preflight.status,
    criticalUnknowns.length,
  );
  if (stableStringify(bundle.limitations) !== stableStringify(expectedLimitations)) {
    throw new Error('limitations do not match derived state');
  }
  if (typeof bundle.blocked !== 'boolean') {
    throw new TypeError('brand evidence bundle blocked must be a boolean');
  }
  if (bundle.blocked !== (criticalUnknowns.length > 0)) {
    throw new Error('blocked must be recomputed from criticalUnknowns');
  }
  if (typeof bundle.evidenceHash !== 'string' || !SHA256.test(bundle.evidenceHash)) {
    throw new TypeError(
      'brand evidence bundle evidenceHash must be 64 lowercase hexadecimal characters',
    );
  }
  const withoutHash = {};
  for (const field of BUNDLE_FIELDS) {
    if (field !== 'evidenceHash') withoutHash[field] = bundle[field];
  }
  if (stableSha256(withoutHash) !== bundle.evidenceHash) {
    throw new Error('brand evidence bundle evidenceHash does not match content');
  }
  return true;
}

function normalizeTrustedOptions(value, taskIdentity) {
  if (value === undefined) {
    throw new Error('trusted options are required');
  }
  const options = snapshotStableJson(value, 'trusted options');
  assertPlain(options, 'trusted options');
  rejectUnknown(options, TRUSTED_OPTIONS_FIELDS, 'trusted options');
  requireFields(options, TRUSTED_OPTIONS_FIELDS, 'trusted options');
  return {
    projectRoot: options.projectRoot,
    projectContext: validateProjectContext(
      options.projectContext,
      taskIdentity,
    ),
    receiptBinding: options.receiptBinding,
  };
}

async function readKnowledgeReceipt({ projectRoot, locator, taskIdentity }) {
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) {
    throw new TypeError('projectRoot must be an absolute path');
  }
  assertPlain(locator, 'feishuPreflight');
  rejectUnknown(locator, LOCATOR_FIELDS, 'feishuPreflight');
  requireFields(locator, LOCATOR_FIELDS, 'feishuPreflight');
  const receiptPath = validateReceiptPath(locator.receiptPath);
  if (
    typeof locator.receiptSha256 !== 'string'
    || !SHA256.test(locator.receiptSha256)
  ) {
    throw new TypeError(
      'feishuPreflight receiptSha256 must be 64 lowercase hexadecimal characters',
    );
  }

  let canonicalRoot;
  try {
    canonicalRoot = await realpath(projectRoot);
  } catch {
    throw new Error('projectRoot does not exist');
  }
  if (!(await stat(canonicalRoot)).isDirectory()) {
    throw new Error('projectRoot must be a directory');
  }
  const taskRoot = path.resolve(
    canonicalRoot,
    'business-projects',
    taskIdentity.enterpriseId,
    taskIdentity.businessProjectId,
    'organizations',
    'ai-brand-officer',
    'tasks',
    taskIdentity.taskId,
  );
  const target = path.resolve(canonicalRoot, ...receiptPath.split('/'));
  const taskRelative = path.relative(taskRoot, target);
  const taskSegments = taskRelative.split(path.sep);
  if (
    !inside(taskRoot, target)
    || !['evidence', 'knowledge'].includes(taskSegments[0])
  ) {
    throw new Error(
      'knowledge receipt must be inside the task evidence boundary',
    );
  }

  const rootRelative = path.relative(canonicalRoot, target);
  let cursor = canonicalRoot;
  for (const segment of rootRelative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    let info;
    try {
      info = await lstat(cursor);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new Error('knowledge receipt does not exist');
      }
      throw error;
    }
    if (info.isSymbolicLink()) {
      throw new Error(
        'knowledge receipt path must not contain a symbolic link or reparse point',
      );
    }
    if (cursor !== target && !info.isDirectory()) {
      throw new Error('knowledge receipt parent must be a directory');
    }
  }
  const targetInfo = await lstat(target);
  if (!targetInfo.isFile()) {
    throw new Error('knowledge receipt must be a regular file');
  }
  if (targetInfo.size > MAX_JSON_BYTES) {
    throw new Error('knowledge receipt must not exceed 1 MB');
  }
  const canonicalTarget = await realpath(target);
  if (!inside(taskRoot, canonicalTarget)) {
    throw new Error(
      'knowledge receipt must be inside the task evidence boundary',
    );
  }
  const bytes = await readFile(target);
  if (bytes.byteLength > MAX_JSON_BYTES) {
    throw new Error('knowledge receipt must not exceed 1 MB');
  }
  const receiptSha256 = createHash('sha256').update(bytes).digest('hex');
  if (receiptSha256 !== locator.receiptSha256) {
    throw new Error('knowledge receipt SHA-256 mismatch');
  }
  if (
    bytes.length >= 3
    && bytes[0] === 0xef
    && bytes[1] === 0xbb
    && bytes[2] === 0xbf
  ) {
    throw new Error('knowledge receipt must not contain a BOM');
  }
  let receiptText;
  try {
    receiptText = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('knowledge receipt UTF-8 encoding is invalid');
  }
  let raw;
  try {
    raw = JSON.parse(receiptText);
  } catch {
    throw new Error('knowledge receipt must contain valid UTF-8 JSON');
  }
  validateRawReceiptShape(raw);
  let context;
  try {
    context = createKnowledgeContext(raw);
  } catch (error) {
    throw new Error(`knowledge receipt is invalid: ${error.message}`);
  }
  if (context.status === 'skipped_non_business') {
    throw new Error(
      'knowledge receipt status skipped_non_business is not allowed for formal brand evidence',
    );
  }
  if (!FORMAL_FEISHU_STATUSES.has(context.status)) {
    throw new Error('knowledge receipt status is invalid');
  }
  if (context.requestId !== taskIdentity.taskId) {
    throw new Error('knowledge receipt requestId does not match task identity');
  }
  const names = context.spaces.map((space) => space.name);
  for (const name of DEFAULT_FEISHU_SPACES) {
    if (!names.includes(name)) {
      throw new Error(`knowledge receipt spaces must include ${name}`);
    }
  }
  for (const [index, source] of context.sources.entries()) {
    validateFeishuSource(source, `knowledge receipt sources[${index}]`);
  }
  return {
    receiptPath,
    receiptSha256,
    requestId: context.requestId,
    generatedAt: context.generatedAt,
    status: context.status,
    spaces: context.spaces.map((space) => ({ ...space })),
    queries: [...context.queries],
    sources: context.sources.map((source) => ({ ...source })),
    degradedReason: context.degradedReason,
  };
}

function validateRawReceiptShape(value) {
  assertPlain(value, 'knowledge receipt');
  rejectUnknown(value, RECEIPT_FIELDS, 'knowledge receipt');
  requireFields(value, RECEIPT_FIELDS, 'knowledge receipt');
  if (value.schemaVersion !== 1) {
    throw new Error('knowledge receipt schemaVersion must be 1');
  }
  validateExactObjectArray(value.spaces, SPACE_FIELDS, 'knowledge receipt spaces');
  validateExactObjectArray(value.sources, SOURCE_FIELDS, 'knowledge receipt sources');
  validateExactObjectArray(
    value.unreadCandidates,
    UNREAD_FIELDS,
    'knowledge receipt unreadCandidates',
  );
}

function validateExactObjectArray(value, fields, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  value.forEach((item, index) => {
    const itemLabel = `${label}[${index}]`;
    assertPlain(item, itemLabel);
    rejectUnknown(item, fields, itemLabel);
    requireFields(item, fields, itemLabel);
  });
}

function validatePreflightOutput(value) {
  assertPlain(value, 'brand evidence bundle feishuPreflight');
  rejectUnknown(
    value,
    PREFLIGHT_FIELDS,
    'brand evidence bundle feishuPreflight',
  );
  requireFields(
    value,
    PREFLIGHT_FIELDS,
    'brand evidence bundle feishuPreflight',
  );
  const receiptPath = validateReceiptPath(value.receiptPath);
  if (typeof value.receiptSha256 !== 'string' || !SHA256.test(value.receiptSha256)) {
    throw new TypeError('feishuPreflight receiptSha256 is invalid');
  }
  if (!FORMAL_FEISHU_STATUSES.has(value.status)) {
    throw new TypeError('feishuPreflight status is invalid');
  }
  if (typeof value.requestId !== 'string' || value.requestId.length === 0) {
    throw new TypeError('feishuPreflight requestId is invalid');
  }
  if (
    typeof value.generatedAt !== 'string'
    || Number.isNaN(Date.parse(value.generatedAt))
  ) {
    throw new TypeError('feishuPreflight generatedAt is invalid');
  }
  validateExactObjectArray(value.spaces, SPACE_FIELDS, 'feishuPreflight spaces');
  const names = value.spaces.map((space) => space.name);
  for (const name of DEFAULT_FEISHU_SPACES) {
    if (!names.includes(name)) {
      throw new Error(`feishuPreflight spaces must include ${name}`);
    }
  }
  if (!Array.isArray(value.queries)) {
    throw new TypeError('feishuPreflight queries must be an array');
  }
  for (const query of value.queries) {
    normalizeText(query, 'feishuPreflight query', 500);
  }
  validateExactObjectArray(value.sources, SOURCE_FIELDS, 'feishuPreflight sources');
  for (const [index, source] of value.sources.entries()) {
    validateFeishuSource(source, `feishuPreflight sources[${index}]`);
  }
  if (
    typeof value.degradedReason !== 'string'
    || (value.status === 'degraded' && value.degradedReason.length === 0)
  ) {
    throw new TypeError('feishuPreflight degradedReason is invalid');
  }
  if (value.status === 'matched' && value.sources.length === 0) {
    throw new Error('matched knowledge context requires sources');
  }
  if (value.status !== 'matched' && value.sources.length !== 0) {
    throw new Error('non-matched knowledge context cannot contain sources');
  }
  return {
    ...value,
    receiptPath,
  };
}

function validateProjectContext(value, taskIdentity) {
  assertPlain(value, 'project context');
  rejectUnknown(value, PROJECT_CONTEXT_FIELDS, 'project context');
  requireFields(value, PROJECT_CONTEXT_FIELDS, 'project context');
  if (value.schemaVersion !== 1) {
    throw new Error('project context schemaVersion must be 1');
  }
  const contextIdentity = validateTaskIdentity({
    enterpriseId: value.enterpriseId,
    businessProjectId: value.businessProjectId,
    taskId: value.taskId,
  });
  for (const field of ['taskId', 'enterpriseId', 'businessProjectId']) {
    if (contextIdentity[field] !== taskIdentity[field]) {
      throw new Error(`project context ${field} does not match task identity`);
    }
  }
  if (
    !Number.isSafeInteger(value.projectContextVersion)
    || value.projectContextVersion < 1
  ) {
    throw new TypeError(
      'projectContextVersion must be a positive safe integer',
    );
  }
  return {
    schemaVersion: 1,
    ...contextIdentity,
    projectContextVersion: value.projectContextVersion,
    readableArtifacts: normalizeArtifacts(
      value.readableArtifacts,
      'readableArtifacts',
    ),
  };
}

function validateAuthorizationContext(value) {
  assertPlain(value, 'authorizationContext');
  rejectUnknown(value, AUTHORIZATION_FIELDS, 'authorizationContext');
  requireFields(value, AUTHORIZATION_FIELDS, 'authorizationContext');
  if (
    !Number.isSafeInteger(value.projectContextVersion)
    || value.projectContextVersion < 1
  ) {
    throw new TypeError('authorizationContext projectContextVersion is invalid');
  }
  if (
    typeof value.readableArtifactsHash !== 'string'
    || !SHA256.test(value.readableArtifactsHash)
  ) {
    throw new TypeError('authorizationContext readableArtifactsHash is invalid');
  }
  return { ...value };
}

function normalizeArtifacts(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  if (value.length > MAX_ARTIFACTS) {
    throw new TypeError(`${label} must contain at most ${MAX_ARTIFACTS} entries`);
  }
  const seen = new Set();
  const normalized = value.map((artifact, index) => {
    const itemLabel = `${label}[${index}]`;
    assertPlain(artifact, itemLabel);
    rejectUnknown(artifact, ARTIFACT_FIELDS, itemLabel);
    requireFields(artifact, ARTIFACT_FIELDS, itemLabel);
    const item = {
      artifactId: safeId(artifact.artifactId, `${itemLabel} artifactId`),
      version: artifact.version,
      sha256: artifact.sha256,
      sourceOrganizationId: safeId(
        artifact.sourceOrganizationId,
        `${itemLabel} sourceOrganizationId`,
      ),
    };
    if (!Number.isSafeInteger(item.version) || item.version < 1) {
      throw new TypeError(`${itemLabel} version must be a positive safe integer`);
    }
    if (typeof item.sha256 !== 'string' || !SHA256.test(item.sha256)) {
      throw new TypeError(`${itemLabel} sha256 is invalid`);
    }
    const key = artifactKey(item);
    if (seen.has(key)) throw new Error(`duplicate artifact reference: ${key}`);
    seen.add(key);
    return item;
  });
  return normalized.sort(compareArtifacts);
}

function bindAuthorizedArtifacts(readableArtifacts, requested) {
  if (requested === undefined) {
    return readableArtifacts.map((artifact) => ({ ...artifact }));
  }
  const requestedArtifacts = normalizeArtifacts(
    requested,
    'requestedUpstreamArtifacts',
  );
  assertArtifactsAuthorized(readableArtifacts, requestedArtifacts);
  return requestedArtifacts;
}

function assertArtifactsAuthorized(readableArtifacts, requestedArtifacts) {
  const authorized = new Map(
    readableArtifacts.map((artifact) => [artifactKey(artifact), artifact]),
  );
  for (const artifact of requestedArtifacts) {
    const expected = authorized.get(artifactKey(artifact));
    if (
      !expected
      || expected.sha256 !== artifact.sha256
      || expected.sourceOrganizationId !== artifact.sourceOrganizationId
    ) {
      throw new Error(
        `upstream artifact ${artifactKey(artifact)} is not authorized by project context`,
      );
    }
  }
}

function normalizeEvidenceArray(value, label, category, allowedFields) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  if (value.length > MAX_INPUT_EVIDENCE) {
    throw new TypeError(`${label} contains too many entries`);
  }
  return value.map((item, index) => {
    const itemLabel = `${label}[${index}]`;
    assertPlain(item, itemLabel);
    rejectUnknown(item, allowedFields, itemLabel);
    requireFields(item, ['id', 'claim', 'sourceRef', 'confidence'], itemLabel);
    return validateEvidenceEntry(withOptionalClaimKey({
      evidenceId: safeId(item.id, `${itemLabel} id`),
      category,
      claim: normalizeText(
        item.claim,
        `${itemLabel} claim`,
        MAX_CLAIM_CODE_POINTS,
      ),
      sourceRef: normalizeText(
        item.sourceRef,
        `${itemLabel} sourceRef`,
        MAX_SOURCE_REF_CODE_POINTS,
      ),
      confidence: validateConfidence(item.confidence, itemLabel),
    }, normalizeClaimKey(item.claimKey, itemLabel)), itemLabel);
  });
}

function normalizePublicSources(value) {
  if (!Array.isArray(value)) throw new TypeError('publicSources must be an array');
  if (value.length > MAX_INPUT_EVIDENCE) {
    throw new TypeError('publicSources contains too many entries');
  }
  return value.map((item, index) => {
    const label = `publicSources[${index}]`;
    assertPlain(item, label);
    rejectUnknown(item, PUBLIC_INPUT_FIELDS, label);
    requireFields(item, ['id', 'claim', 'url', 'confidence'], label);
    const url = validateSecurePublicHttpsUrl(
      normalizeText(item.url, `${label} url`, MAX_SOURCE_REF_CODE_POINTS),
      'public-web evidence sourceRef',
    );
    return validateEvidenceEntry(withOptionalClaimKey({
      evidenceId: safeId(item.id, `${label} id`),
      category: 'public-web',
      claim: normalizeText(item.claim, `${label} claim`, MAX_CLAIM_CODE_POINTS),
      sourceRef: url,
      confidence: validateConfidence(item.confidence, label),
    }, normalizeClaimKey(item.claimKey, label)), label);
  });
}

function normalizeProfessionalJudgments(value) {
  if (!Array.isArray(value)) {
    throw new TypeError('professionalJudgments must be an array');
  }
  if (value.length > MAX_INPUT_EVIDENCE) {
    throw new TypeError('professionalJudgments contains too many entries');
  }
  return value.map((item, index) => {
    const label = `professionalJudgments[${index}]`;
    assertPlain(item, label);
    rejectUnknown(item, PROFESSIONAL_INPUT_FIELDS, label);
    requireFields(
      item,
      ['id', 'category', 'claim', 'sourceRef', 'confidence'],
      label,
    );
    if (!PROFESSIONAL_CATEGORIES.has(item.category)) {
      throw new TypeError(`${label} category is invalid`);
    }
    return validateEvidenceEntry(withOptionalClaimKey({
      evidenceId: safeId(item.id, `${label} id`),
      category: item.category,
      claim: normalizeText(item.claim, `${label} claim`, MAX_CLAIM_CODE_POINTS),
      sourceRef: normalizeText(
        item.sourceRef,
        `${label} sourceRef`,
        MAX_SOURCE_REF_CODE_POINTS,
      ),
      confidence: validateConfidence(item.confidence, label),
    }, normalizeClaimKey(item.claimKey, label)), label);
  });
}

function normalizeCriticalUnknowns(value) {
  if (!Array.isArray(value)) {
    throw new TypeError('criticalUnknowns must be an array');
  }
  if (value.length > MAX_INPUT_EVIDENCE) {
    throw new TypeError('criticalUnknowns contains too many entries');
  }
  const seen = new Set();
  return value.map((item, index) => {
    const label = `criticalUnknowns[${index}]`;
    assertPlain(item, label);
    rejectUnknown(item, CRITICAL_UNKNOWN_FIELDS, label);
    requireFields(item, CRITICAL_UNKNOWN_FIELDS, label);
    if (!CRITICAL_FIELDS.has(item.criticalField)) {
      throw new TypeError(`${label} criticalField is invalid`);
    }
    const criticalUnknown = {
      id: safeId(item.id, `${label} id`),
      criticalField: item.criticalField,
      description: normalizeText(
        item.description,
        `${label} description`,
        MAX_CLAIM_CODE_POINTS,
      ),
      sourceRef: normalizeText(
        item.sourceRef,
        `${label} sourceRef`,
        MAX_SOURCE_REF_CODE_POINTS,
      ),
    };
    if (seen.has(criticalUnknown.id)) {
      throw new Error(`duplicate criticalUnknown id: ${criticalUnknown.id}`);
    }
    seen.add(criticalUnknown.id);
    return {
      criticalUnknown,
      entry: validateEvidenceEntry({
        evidenceId: criticalUnknown.id,
        category: 'unknown',
        claim: criticalUnknown.description,
        sourceRef: criticalUnknown.sourceRef,
        confidence: 'unknown',
        claimKey: criticalClaimKey(criticalUnknown),
      }, `${label} normalized entry`),
    };
  });
}

function feishuEntries(sources) {
  return sources.map((source, index) => validateEvidenceEntry({
    evidenceId: `feishu-${stableSha256(source).slice(0, 24)}`,
    category: 'feishu',
    claim: source.excerpt,
    sourceRef: source.url || `feishu-token:${source.token}`,
    confidence: 'confirmed',
  }, `Feishu source entry[${index}]`));
}

function artifactEvidenceEntry(artifact) {
  return {
    evidenceId: `upstream-${stableSha256(artifact).slice(0, 24)}`,
    category: 'upstream-artifact',
    claim:
      `Bound authorized upstream artifact ${artifact.artifactId}@${artifact.version}.`,
    sourceRef:
      `${artifact.artifactId}@${artifact.version}#sha256:${artifact.sha256}`,
    confidence: 'confirmed',
  };
}

function validateEvidenceEntry(value, label) {
  assertPlain(value, label);
  rejectUnknown(value, ENTRY_FIELDS, label);
  requireFields(
    value,
    ['evidenceId', 'category', 'claim', 'sourceRef', 'confidence'],
    label,
  );
  if (!EVIDENCE_CATEGORIES.has(value.category)) {
    throw new TypeError(`${label} category is invalid`);
  }
  const normalized = withOptionalClaimKey({
    evidenceId: safeId(value.evidenceId, `${label} evidenceId`),
    category: value.category,
    claim: normalizeText(value.claim, `${label} claim`, MAX_CLAIM_CODE_POINTS),
    sourceRef: normalizeText(
      value.sourceRef,
      `${label} sourceRef`,
      MAX_SOURCE_REF_CODE_POINTS,
    ),
    confidence: validateConfidence(value.confidence, label),
  }, Object.hasOwn(value, 'claimKey')
    ? safeId(value.claimKey, `${label} claimKey`)
    : undefined);
  if (
    ['feishu', 'conversation', 'public-web'].includes(normalized.category)
    && normalized.confidence === 'unknown'
  ) {
    throw new TypeError(
      `${normalized.category} evidence confidence must not be unknown`,
    );
  }
  if (normalized.category === 'public-web') {
    validateSecurePublicHttpsUrl(
      normalized.sourceRef,
      'public-web evidence sourceRef',
    );
  }
  if (normalized.category === 'feishu') {
    validateFeishuReference(normalized.sourceRef);
  }
  if (PROFESSIONAL_CATEGORIES.has(normalized.category)) {
    validateProfessionalConfidence(
      normalized.category,
      normalized.confidence,
    );
  }
  if (normalized.category === 'upstream-artifact') {
    if (normalized.confidence !== 'confirmed') {
      throw new TypeError('upstream artifact evidence must be confirmed');
    }
    if (normalized.claimKey !== undefined) {
      throw new TypeError('upstream artifact evidence must not have claimKey');
    }
  }
  return normalized;
}

function validateBundleEntries(value) {
  if (!Array.isArray(value)) {
    throw new TypeError('brand evidence bundle entries must be an array');
  }
  if (value.length > MAX_INPUT_EVIDENCE + MAX_ARTIFACTS) {
    throw new TypeError('brand evidence bundle entries exceed the maximum');
  }
  const entries = value.map((entry, index) =>
    validateEvidenceEntry(entry, `brand evidence bundle entries[${index}]`));
  ensureUniqueEvidenceIds(entries);
  return entries;
}

function buildConflicts(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    if (entry.claimKey === undefined) continue;
    const group = grouped.get(entry.claimKey) ?? [];
    group.push(entry);
    grouped.set(entry.claimKey, group);
  }
  const conflicts = [];
  for (const [claimKey, group] of grouped) {
    const ordered = [...group].sort((left, right) =>
      left.evidenceId.localeCompare(right.evidenceId, 'en'));
    if (new Set(ordered.map((entry) => entry.claim)).size < 2) continue;
    const evidenceIds = ordered.map((entry) => entry.evidenceId);
    const claims = ordered.map((entry) => entry.claim);
    conflicts.push({
      conflictId: `conflict-${stableSha256({
        claimKey,
        evidenceIds,
        claims,
      }).slice(0, 24)}`,
      claimKey,
      evidenceIds,
      claims,
      resolutionStatus: 'unresolved',
    });
  }
  if (conflicts.length > MAX_CONFLICTS) {
    throw new TypeError(`conflicts must contain at most ${MAX_CONFLICTS} entries`);
  }
  return conflicts.sort((left, right) =>
    left.claimKey.localeCompare(right.claimKey, 'en'));
}

function validateConflicts(value, entries) {
  if (!Array.isArray(value)) {
    throw new TypeError('brand evidence bundle conflicts must be an array');
  }
  const normalized = value.map((conflict, index) => {
    const label = `brand evidence bundle conflicts[${index}]`;
    assertPlain(conflict, label);
    rejectUnknown(conflict, CONFLICT_FIELDS, label);
    requireFields(conflict, CONFLICT_FIELDS, label);
    if (conflict.resolutionStatus !== 'unresolved') {
      throw new TypeError(`${label} resolutionStatus must be unresolved`);
    }
    return {
      conflictId: safeId(conflict.conflictId, `${label} conflictId`),
      claimKey: safeId(conflict.claimKey, `${label} claimKey`),
      evidenceIds: validateSafeIdArray(conflict.evidenceIds, `${label} evidenceIds`),
      claims: validateTextArray(conflict.claims, `${label} claims`),
      resolutionStatus: 'unresolved',
    };
  });
  const expected = buildConflicts(entries);
  if (stableStringify(normalized) !== stableStringify(expected)) {
    throw new Error('brand evidence bundle conflicts do not match entries');
  }
}

function validateFeishuEntrySemantics(sources, entries) {
  const expected = feishuEntries(sources).sort(compareEntries);
  const actual = entries.filter((entry) => entry.category === 'feishu');
  if (stableStringify(actual) !== stableStringify(expected)) {
    throw new Error('Feishu evidence entries do not match receipt sources');
  }
}

function validateArtifactEntrySemantics(artifacts, entries) {
  const expected = artifacts.map(artifactEvidenceEntry).sort(compareEntries);
  const actual = entries.filter(
    (entry) => entry.category === 'upstream-artifact',
  );
  if (stableStringify(actual) !== stableStringify(expected)) {
    throw new Error(
      'upstream artifact evidence entry does not match artifact reference',
    );
  }
}

function validateCriticalEntrySemantics(records, entries) {
  const expected = records.map(({ entry }) => entry).sort(compareEntries);
  const actual = entries.filter(
    (entry) => entry.claimKey && CRITICAL_CLAIM_KEY.test(entry.claimKey),
  );
  if (stableStringify(actual) !== stableStringify(expected)) {
    throw new Error(
      'critical unknown evidence entries do not match criticalUnknowns',
    );
  }
}

function deriveLimitations(status, criticalUnknownCount) {
  const limitations = [];
  if (status === 'no_hit') limitations.push(LIMITATION_ORDER[0]);
  if (status === 'degraded') limitations.push(LIMITATION_ORDER[1]);
  if (criticalUnknownCount > 0) limitations.push(LIMITATION_ORDER[2]);
  return limitations;
}

function validateFeishuSource(source, label) {
  if (source.url) {
    try {
      validateSecurePublicHttpsUrl(source.url, `${label} source URL`);
    } catch {
      throw new TypeError(`${label} source URL must be secure HTTPS`);
    }
    return;
  }
  if (!FEISHU_TOKEN.test(source.token)) {
    throw new TypeError(`${label} source token is invalid`);
  }
}

function validateFeishuReference(value) {
  if (value.startsWith('feishu-token:')) {
    if (!FEISHU_TOKEN.test(value.slice('feishu-token:'.length))) {
      throw new TypeError('Feishu evidence source token is invalid');
    }
    return value;
  }
  return validateSecurePublicHttpsUrl(value, 'Feishu evidence source URL');
}

function validateSecurePublicHttpsUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${label} must be a secure public HTTPS URL`);
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || !parsed.hostname
    || isPrivateHost(parsed.hostname)
  ) {
    throw new TypeError(`${label} must be a secure public HTTPS URL`);
  }
  return value;
}

function isPrivateHost(hostname) {
  const host = hostname
    .toLowerCase()
    .replace(/\.+$/u, '')
    .replace(/^\[|\]$/gu, '');
  if (
    host.length === 0
    || host === 'localhost'
    || host.endsWith('.localhost')
    || host === '::'
    || host === '::1'
    || host === '0:0:0:0:0:0:0:1'
    || host.startsWith('fc')
    || host.startsWith('fd')
    || /^fe[89ab]/u.test(host)
    || host.startsWith('ff')
  ) {
    return true;
  }
  if (host.startsWith('::ffff:')) {
    const tail = host.slice('::ffff:'.length).split(':');
    if (tail.length === 2) {
      const high = Number.parseInt(tail[0], 16);
      const low = Number.parseInt(tail[1], 16);
      if (
        Number.isInteger(high)
        && Number.isInteger(low)
        && high >= 0
        && high <= 0xffff
        && low >= 0
        && low <= 0xffff
      ) {
        return isPrivateIpv4([
          high >> 8,
          high & 0xff,
          low >> 8,
          low & 0xff,
        ]);
      }
    }
    return true;
  }
  const parts = host.split('.');
  if (
    parts.length === 4
    && parts.every((part) => /^\d{1,3}$/u.test(part))
  ) {
    const octets = parts.map(Number);
    if (octets.some((octet) => octet > 255)) return true;
    return isPrivateIpv4(octets);
  }
  return false;
}

function isPrivateIpv4(octets) {
  return (
    octets[0] === 0
    || octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
    || octets[0] >= 224
  );
}

function validateReceiptPath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || path.isAbsolute(value)
    || value.startsWith('/')
    || value.startsWith('\\\\')
    || value.includes('\\')
    || value.includes(':')
    || value.includes('\0')
  ) {
    throw new TypeError(
      'feishuPreflight receiptPath must be a safe project-relative path',
    );
  }
  const segments = value.split('/');
  if (
    segments.some((segment) => (
      segment === ''
      || segment === '.'
      || segment === '..'
      || /[.\s]$/u.test(segment)
      || WINDOWS_DEVICE_SEGMENT.test(segment)
      || /[\u0000-\u001f\u007f]/u.test(segment)
    ))
  ) {
    throw new TypeError(
      'feishuPreflight receiptPath must be a safe project-relative path',
    );
  }
  return value;
}

function validateConfidence(value, label) {
  if (!CONFIDENCE_VALUES.has(value)) {
    throw new TypeError(`${label} confidence is invalid`);
  }
  return value;
}

function validateSkillId(value, label) {
  if (
    typeof value !== 'string'
    || !Object.hasOwn(BRAND_SKILL_MODULES, value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function validateProfessionalConfidence(category, confidence) {
  if (category === 'unknown' && confidence !== 'unknown') {
    throw new TypeError('unknown evidence confidence must be unknown');
  }
  if (category === 'assumption' && confidence !== 'provisional') {
    throw new TypeError('assumption evidence confidence must be provisional');
  }
  if (
    ['professional-judgment', 'inference'].includes(category)
    && !['supported', 'provisional'].includes(confidence)
  ) {
    throw new TypeError(
      `${category} evidence confidence must be supported or provisional`,
    );
  }
}

function validateSafeIdArray(value, label) {
  if (!Array.isArray(value) || value.length < 2) {
    throw new TypeError(`${label} must contain at least two ids`);
  }
  const result = value.map((item, index) =>
    safeId(item, `${label}[${index}]`));
  if (new Set(result).size !== result.length) {
    throw new Error(`${label} must contain unique ids`);
  }
  return result;
}

function validateTextArray(value, label) {
  if (!Array.isArray(value) || value.length < 2) {
    throw new TypeError(`${label} must contain at least two claims`);
  }
  return value.map((item, index) =>
    normalizeText(item, `${label}[${index}]`, MAX_CLAIM_CODE_POINTS));
}

function ensureUniqueEvidenceIds(entries) {
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.evidenceId)) {
      throw new Error(`duplicate evidenceId: ${entry.evidenceId}`);
    }
    seen.add(entry.evidenceId);
  }
}

function normalizeText(value, label, maximumCodePoints) {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || value.length === 0
  ) {
    throw new TypeError(`${label} must be a non-empty normalized string`);
  }
  if ([...value].length > maximumCodePoints) {
    throw new TypeError(
      `${label} must contain at most ${maximumCodePoints} characters`,
    );
  }
  return value;
}

function normalizeClaimKey(value, label) {
  if (value === undefined) return undefined;
  const claimKey = safeId(value, `${label} claimKey`);
  if (CRITICAL_CLAIM_KEY.test(claimKey)) {
    throw new Error(`${label} claimKey uses a reserved critical marker`);
  }
  return claimKey;
}

function requireFields(value, fields, label) {
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) {
      throw new Error(`${label} is missing field: ${field}`);
    }
  }
}

function withOptionalClaimKey(entry, claimKey) {
  return claimKey === undefined ? entry : { ...entry, claimKey };
}

function artifactKey(artifact) {
  return `${artifact.artifactId}@${artifact.version}`;
}

function criticalClaimKey(criticalUnknown) {
  return `critical-${stableSha256(criticalUnknown).slice(0, 24)}`;
}

function compareArtifacts(left, right) {
  return (
    left.artifactId.localeCompare(right.artifactId, 'en')
    || left.version - right.version
    || left.sha256.localeCompare(right.sha256, 'en')
    || left.sourceOrganizationId.localeCompare(
      right.sourceOrganizationId,
      'en',
    )
  );
}

function compareCriticalUnknowns(left, right) {
  return left.id.localeCompare(right.id, 'en');
}

function compareEntries(left, right) {
  return (
    CATEGORY_ORDER.indexOf(left.category)
      - CATEGORY_ORDER.indexOf(right.category)
    || left.evidenceId.localeCompare(right.evidenceId, 'en')
  );
}

function assertCanonical(actual, canonical, label) {
  if (stableStringify(actual) !== stableStringify(canonical)) {
    throw new Error(`${label} must use canonical ordering`);
  }
}

function sameArray(left, right) {
  return (
    Array.isArray(left)
    && left.length === right.length
    && left.every((item, index) => item === right[index])
  );
}

function inside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function snapshotStableJson(value, label) {
  const state = {
    bytes: 0,
    nodes: 0,
    items: 0,
  };
  return cloneStableJson(value, label, 0, new Set(), state);
}

function cloneStableJson(value, label, depth, ancestors, state) {
  state.nodes += 1;
  if (state.nodes > MAX_TOTAL_NODES) snapshotLimit(label);
  if (value === null) {
    state.bytes += 4;
    checkSnapshotBytes(label, state);
    return null;
  }
  if (typeof value === 'string') {
    state.bytes += Buffer.byteLength(value, 'utf8') + 2;
    checkSnapshotBytes(label, state);
    return value;
  }
  if (typeof value === 'boolean') {
    state.bytes += value ? 4 : 5;
    checkSnapshotBytes(label, state);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${label} must be stable JSON with finite numbers`);
    }
    state.bytes += String(value).length;
    checkSnapshotBytes(label, state);
    return value;
  }
  if (typeof value !== 'object') {
    throw new TypeError(
      `${label} must be stable JSON without function or symbol values`,
    );
  }
  if (utilTypes.isProxy(value)) {
    throw new TypeError(`${label} Proxy inputs are unsupported`);
  }
  if (depth > MAX_JSON_DEPTH) {
    throw new TypeError(
      `${label} stable JSON must not exceed depth ${MAX_JSON_DEPTH}`,
    );
  }
  if (ancestors.has(value)) {
    throw new TypeError(`${label} stable JSON contains a circular reference`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${label} stable JSON must not contain symbol keys`);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY_ITEMS) snapshotLimit(label);
      state.items += value.length;
      if (state.items > MAX_TOTAL_ITEMS) snapshotLimit(label);
      const names = Object.getOwnPropertyNames(value);
      const permitted = new Set([
        'length',
        ...Array.from({ length: value.length }, (_, index) => String(index)),
      ]);
      if (names.some((name) => !permitted.has(name))) {
        throw new TypeError(`${label} stable JSON array has extra properties`);
      }
      const clone = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );
        if (!descriptor) {
          throw new TypeError(`${label} stable JSON does not support sparse arrays`);
        }
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
    const names = Object.getOwnPropertyNames(value);
    if (names.length > MAX_OBJECT_PROPERTIES) snapshotLimit(label);
    state.items += names.length;
    if (state.items > MAX_TOTAL_ITEMS) snapshotLimit(label);
    const clone = {};
    for (const name of names) {
      state.bytes += Buffer.byteLength(name, 'utf8') + 3;
      checkSnapshotBytes(label, state);
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      assertDataDescriptor(descriptor, `${label}.${name}`);
      if (!descriptor.enumerable) {
        throw new TypeError(`${label}.${name} must be an enumerable JSON property`);
      }
      clone[name] = cloneStableJson(
        descriptor.value,
        `${label}.${name}`,
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

function checkSnapshotBytes(label, state) {
  if (state.bytes > MAX_JSON_BYTES) snapshotLimit(label);
}

function snapshotLimit(label) {
  throw new TypeError(`${label} snapshot resource limit exceeds 1 MB`);
}

function assertDataDescriptor(descriptor, label) {
  if (
    !descriptor
    || typeof descriptor.get === 'function'
    || typeof descriptor.set === 'function'
  ) {
    throw new TypeError(`${label} accessor properties are unsupported`);
  }
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}
