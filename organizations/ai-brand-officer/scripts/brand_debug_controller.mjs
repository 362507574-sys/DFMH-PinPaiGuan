import { types as utilTypes } from 'node:util';

import {
  BRAND_SKILL_MODULES,
  assertPlain,
  safeId,
  stableSha256,
  stableStringify,
  validateTaskIdentity,
} from './brand_contracts.mjs';
import { validateBrandCandidateReview } from './brand_quality_gate.mjs';

const STATE_FIELDS = Object.freeze([
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
const CREATE_FIELDS = Object.freeze([
  'taskIdentity',
  'skillId',
  'planHash',
  'evidenceHash',
  'now',
]);
const ADVANCE_FIELDS = Object.freeze(['current', 'event', 'now']);
const RUNTIME_FIELDS = Object.freeze([
  'resolveReview',
  'initializeDebugState',
  'readDebugState',
  'commitDebugState',
]);
const ACTIVE_CORRECTION_FIELDS = Object.freeze([
  'roundId',
  'rootCauseFingerprint',
  'rootCauseCode',
  'treatmentId',
  'actionHash',
  'inputCandidateHash',
  'affectedModuleIds',
  'correction',
  'plannedAt',
]);
const APPLIED_CORRECTION_FIELDS = Object.freeze([
  ...ACTIVE_CORRECTION_FIELDS,
  'appliedAt',
  'outputCandidateHash',
  'executionEvidence',
  'validatedByReviewHash',
  'validationVerdict',
]);
const TIMELINE_FIELDS = Object.freeze([
  'sequence',
  'at',
  'eventType',
  'fromStatus',
  'toStatus',
  'previousEventHash',
  'eventHash',
  'note',
  'reviewHash',
  'candidateHash',
  'candidateId',
  'reviewVerdict',
  'rootCauseFingerprint',
  'rootCauseCode',
  'affectedModuleIds',
  'roundId',
  'outputCandidateHash',
  'executionEvidence',
  'transientCause',
  'blockedReportHash',
]);
const BLOCKED_REPORT_FIELDS = Object.freeze([
  'blockedReason',
  'attemptedCorrections',
  'remainingRisks',
  'requestedBusinessInput',
]);
const REVIEW_RESOLUTION_FIELDS = Object.freeze([
  'review',
  'reviewTrustedOptions',
  'diagnostic',
]);
const DIAGNOSTIC_FIELDS = Object.freeze([
  'affectedModuleIds',
  'correction',
  'requiresBusinessDecision',
  'blockedReason',
  'remainingRisks',
  'requestedBusinessInput',
]);
const TREATMENT_IDS = Object.freeze([
  'local-correction',
  'module-rebuild',
  'method-or-path-switch',
]);
const STATUSES = new Set([
  'received',
  'planning',
  'collecting_evidence',
  'executing',
  'reviewing',
  'reworking',
  'candidate_ready',
  'blocked',
  'returned_to_control_center',
]);
const EVENT_TYPES = new Set([
  'start-planning',
  'plan-ready',
  'evidence-ready',
  'execution-ready',
  'review-started',
  'review-passed',
  'review-failed',
  'rework-ready',
  'block',
  'return-to-control-center',
  'transient-failure',
  'transient-recovered',
]);
const BLOCKABLE_STATUSES = new Set([
  'planning',
  'collecting_evidence',
  'executing',
  'reviewing',
  'reworking',
]);
const TRANSIENT_STATUSES = new Set([
  'planning',
  'collecting_evidence',
  'executing',
  'reviewing',
  'reworking',
]);
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_DEPTH = 32;
const MAX_NODES = 30_000;
const MAX_ARRAY_LENGTH = 10_000;
const MAX_OBJECT_PROPERTIES = 1_000;
const MAX_TIMELINE_ITEMS = 1_000;

export async function createBrandDebugState(input, trustedRuntimeInput) {
  const trustedRuntime = validateTrustedRuntime(trustedRuntimeInput);
  const request = snapshotStableJson(input, 'brand debug create input');
  assertPlain(request, 'brand debug create input');
  rejectUnknown(request, CREATE_FIELDS, 'brand debug create input');
  requireFields(request, CREATE_FIELDS, 'brand debug create input');

  const taskIdentity = validateTaskIdentity(request.taskIdentity);
  const skillId = validateSkillId(request.skillId);
  const planHash = validateSha256(request.planHash, 'planHash');
  const evidenceHash = validateSha256(request.evidenceHash, 'evidenceHash');
  const createdAt = validateIso(request.now, 'now');
  const withoutHash = {
    schemaVersion: 1,
    taskIdentity: { ...taskIdentity },
    skillId,
    planHash,
    evidenceHash,
    createdAt,
    revision: 0,
    previousStateHash: null,
    status: 'received',
    rootCauseAttempts: {},
    transientAttempts: {},
    activeCorrection: null,
    attemptedCorrections: [],
    timeline: [],
    blockedReport: null,
  };
  const state = {
    ...withoutHash,
    stateHash: stableSha256(withoutHash),
  };
  validateBrandDebugStateStructure(state);
  const initialized = await trustedRuntime.initializeDebugState({
    taskIdentity: { ...taskIdentity },
    state: snapshotStableJson(state, 'initial brand debug state'),
  });
  if (initialized !== true) {
    throw new Error('brand debug trusted state head already exists or initialize failed');
  }
  return deepFreeze(state);
}

export async function validateBrandDebugState(input, trustedRuntimeInput) {
  const trustedRuntime = validateTrustedRuntime(trustedRuntimeInput);
  const structure = validateBrandDebugStateStructure(input);
  await validateTrustedReviews(structure.state, structure, trustedRuntime);
  const storedInput = await trustedRuntime.readDebugState({
    ...structure.state.taskIdentity,
  });
  if (storedInput === null) {
    throw new Error('brand debug trusted stored state was not found');
  }
  const stored = snapshotStableJson(storedInput, 'trusted stored debug state');
  validateBrandDebugStateStructure(stored);
  if (stableStringify(stored) !== stableStringify(structure.state)) {
    throw new Error('brand debug trusted stored state mismatch');
  }
  return true;
}

export async function advanceBrandDebugState(input, trustedRuntimeInput) {
  const trustedRuntime = validateTrustedRuntime(trustedRuntimeInput);
  const request = snapshotStableJson(input, 'brand debug advance input');
  assertPlain(request, 'brand debug advance input');
  rejectUnknown(request, ADVANCE_FIELDS, 'brand debug advance input');
  requireFields(request, ADVANCE_FIELDS, 'brand debug advance input');
  const event = request.event;
  assertPlain(event, 'brand debug event');
  if (!EVENT_TYPES.has(event.type)) {
    throw new Error(`brand debug event type is invalid: ${String(event.type)}`);
  }
  if (Object.hasOwn(event, 'note')) {
    validateText(event.note, 'event note', 400);
  }

  await validateBrandDebugState(request.current, trustedRuntime);
  const current = request.current;
  if (current.status === 'returned_to_control_center') {
    throw new Error('returned_to_control_center is terminal');
  }
  const at = validateIso(request.now, 'now');
  if (Date.parse(at) < Date.parse(current.createdAt)) {
    throw new Error('timeline event cannot be earlier than createdAt');
  }
  const lastAt = current.timeline.at(-1)?.at;
  if (lastAt !== undefined && Date.parse(at) < Date.parse(lastAt)) {
    throw new Error('timeline time must be monotonic and cannot move earlier');
  }

  const next = cloneStateWithoutHash(current);
  const timelineData = {};
  let toStatus;

  switch (event.type) {
    case 'start-planning':
      validateSimpleEvent(event);
      requireStatus(current.status, 'received', event.type);
      toStatus = 'planning';
      break;
    case 'plan-ready':
      validateSimpleEvent(event);
      requireStatus(current.status, 'planning', event.type);
      toStatus = 'collecting_evidence';
      break;
    case 'evidence-ready':
      validateSimpleEvent(event);
      requireStatus(current.status, 'collecting_evidence', event.type);
      toStatus = 'executing';
      break;
    case 'execution-ready':
      validateSimpleEvent(event);
      requireStatus(current.status, 'executing', event.type);
      if (lastOperationalEvent(current) === 'execution-ready') {
        throw new Error('execution-ready is already recorded for this execution round');
      }
      toStatus = 'executing';
      break;
    case 'review-started':
      validateSimpleEvent(event);
      requireStatus(current.status, 'executing', event.type);
      if (lastOperationalEvent(current) !== 'execution-ready') {
        throw new Error('review-started requires execution-ready');
      }
      toStatus = 'reviewing';
      break;
    case 'review-passed': {
      validateReviewPassedEvent(event);
      requireStatus(current.status, 'reviewing', event.type);
      assertReviewHashUnused(current, event.reviewHash);
      const { review } = await resolveReview(
        event.reviewHash,
        current,
        trustedRuntime,
      );
      if (
        !['preferred', 'candidate_ready'].includes(review.verdict)
        || review.hardVetoes.length > 0
        || review.failedCriteria.length > 0
      ) {
        throw new Error('review-passed requires a real passing Task4 review');
      }
      bindPendingAttempt(next, review);
      Object.assign(timelineData, makeReviewBinding(review));
      next.activeCorrection = null;
      toStatus = 'candidate_ready';
      break;
    }
    case 'review-failed': {
      validateReviewFailedEvent(event);
      requireStatus(current.status, 'reviewing', event.type);
      assertReviewHashUnused(current, event.reviewHash);
      const { review, diagnostic } = await resolveReview(
        event.reviewHash,
        current,
        trustedRuntime,
      );
      if (
        !['rework', 'eliminated'].includes(review.verdict)
        || (
          review.correctionTargets.length === 0
          && review.failedCriteria.length === 0
          && review.hardVetoes.length === 0
        )
      ) {
        throw new Error('review-failed requires a real failed Task4 review');
      }
      const affectedModuleIds = validateAffectedModules(
        diagnostic.affectedModuleIds,
        current.skillId,
      );
      const rootCauseFingerprint = stableSha256({
        failedCriteria: [...review.failedCriteria].sort(),
        hardVetoes: [...review.hardVetoes].sort(),
        correctionTargets: [...review.correctionTargets].sort(),
        affectedModuleIds,
        skillId: current.skillId,
      });
      const rootCauseCode = `cause-${rootCauseFingerprint.slice(0, 16)}`;
      bindPendingAttempt(next, review, rootCauseFingerprint);
      next.rootCauseAttempts = deriveRootCauseAttempts(next.attemptedCorrections);
      Object.assign(timelineData, makeReviewBinding(review), {
        rootCauseFingerprint,
        rootCauseCode,
        affectedModuleIds,
      });
      const businessDecision = diagnostic.requiresBusinessDecision;
      const completedFailures = next.rootCauseAttempts[rootCauseFingerprint] ?? 0;
      const appliedRounds = next.attemptedCorrections.filter(
        (attempt) => attempt.rootCauseFingerprint === rootCauseFingerprint,
      ).length;
      if (businessDecision || completedFailures >= 3 || appliedRounds >= 3) {
        next.blockedReport = buildBlockedReport({
          blockedReason: diagnostic.blockedReason || (
            businessDecision
              ? '该根因需要业务决策，停止自动返工'
              : `${rootCauseCode} 的三种治疗策略已全部执行且复审仍未通过`
          ),
          attemptedCorrections: next.attemptedCorrections,
          remainingRisks: diagnostic.remainingRisks.length > 0
            ? diagnostic.remainingRisks
            : ['审核失败根因仍未消除'],
          requestedBusinessInput: diagnostic.requestedBusinessInput,
        });
        next.activeCorrection = null;
        timelineData.blockedReportHash = stableSha256(next.blockedReport);
        toStatus = 'blocked';
      } else {
        const roundId = `round-${rootCauseFingerprint.slice(0, 12)}-${appliedRounds + 1}`;
        const treatmentId = TREATMENT_IDS[appliedRounds];
        const correction = `${treatmentId}: ${diagnostic.correction}`;
        next.activeCorrection = {
          roundId,
          rootCauseFingerprint,
          rootCauseCode,
          treatmentId,
          actionHash: stableSha256(correction),
          inputCandidateHash: review.candidateHash,
          affectedModuleIds,
          correction: validateText(correction, 'correction', 4000),
          plannedAt: at,
        };
        timelineData.roundId = roundId;
        toStatus = 'reworking';
      }
      break;
    }
    case 'rework-ready': {
      validateReworkReadyEvent(event);
      requireStatus(current.status, 'reworking', event.type);
      if (current.activeCorrection === null) {
        throw new Error('rework-ready requires an active correction');
      }
      if (event.roundId !== current.activeCorrection.roundId) {
        throw new Error('rework-ready roundId does not match active correction');
      }
      const outputCandidateHash = validateSha256(
        event.outputCandidateHash,
        'outputCandidateHash',
      );
      if (outputCandidateHash === current.activeCorrection.inputCandidateHash) {
        throw new Error('rework output candidate must differ from the input candidate');
      }
      const executionEvidence = validateSha256(
        event.executionEvidence,
        'executionEvidence',
      );
      next.attemptedCorrections.push({
        ...cloneCorrection(current.activeCorrection),
        appliedAt: at,
        outputCandidateHash,
        executionEvidence,
        validatedByReviewHash: null,
        validationVerdict: null,
      });
      next.activeCorrection = null;
      Object.assign(timelineData, {
        roundId: event.roundId,
        outputCandidateHash,
        executionEvidence,
      });
      toStatus = 'executing';
      break;
    }
    case 'block':
      validateBlockEvent(event);
      if (!BLOCKABLE_STATUSES.has(current.status)) {
        throw new Error(`block is not allowed from state ${current.status}`);
      }
      next.blockedReport = buildBlockedReport({
        blockedReason: event.blockedReason,
        attemptedCorrections: next.attemptedCorrections,
        remainingRisks: event.remainingRisks,
        requestedBusinessInput: event.requestedBusinessInput,
      });
      next.activeCorrection = null;
      timelineData.blockedReportHash = stableSha256(next.blockedReport);
      toStatus = 'blocked';
      break;
    case 'return-to-control-center':
      validateSimpleEvent(event);
      if (!['candidate_ready', 'blocked'].includes(current.status)) {
        throw new Error(`return-to-control-center is not allowed from ${current.status}`);
      }
      next.activeCorrection = null;
      toStatus = 'returned_to_control_center';
      break;
    case 'transient-failure': {
      validateTransientEvent(event, true);
      if (!TRANSIENT_STATUSES.has(current.status)) {
        throw new Error(`transient-failure is not allowed from ${current.status}`);
      }
      const transientCause = safeId(event.transientCause, 'transientCause');
      const attempt = (next.transientAttempts[transientCause] ?? 0) + 1;
      if (attempt > 3) {
        throw new Error(`transient cause ${transientCause} exhausted three attempts`);
      }
      next.transientAttempts[transientCause] = attempt;
      timelineData.transientCause = transientCause;
      if (attempt === 3) {
        next.blockedReport = buildBlockedReport({
          blockedReason: event.blockedReason
            ?? `瞬时故障 ${transientCause} 第三次发生，停止自动恢复`,
          attemptedCorrections: next.attemptedCorrections,
          remainingRisks: event.remainingRisks ?? [`瞬时故障 ${transientCause} 尚未恢复`],
          requestedBusinessInput: event.requestedBusinessInput ?? [],
        });
        next.activeCorrection = null;
        timelineData.blockedReportHash = stableSha256(next.blockedReport);
        toStatus = 'blocked';
      } else {
        toStatus = current.status;
      }
      break;
    }
    case 'transient-recovered': {
      validateTransientEvent(event, false);
      if (!TRANSIENT_STATUSES.has(current.status)) {
        throw new Error(`transient-recovered is not allowed from ${current.status}`);
      }
      const transientCause = safeId(event.transientCause, 'transientCause');
      if (!isTransientActive(current.timeline, transientCause)) {
        throw new Error(`no active transient failure for ${transientCause}`);
      }
      timelineData.transientCause = transientCause;
      toStatus = current.status;
      break;
    }
    default:
      throw new Error(`unsupported brand debug event: ${event.type}`);
  }

  const note = Object.hasOwn(event, 'note')
    ? validateText(event.note, 'event note', 400)
    : undefined;
  next.status = toStatus;
  const entryWithoutHash = {
    sequence: next.timeline.length + 1,
    at,
    eventType: event.type,
    fromStatus: current.status,
    toStatus,
    previousEventHash: next.timeline.at(-1)?.eventHash ?? null,
    ...timelineData,
    ...(note === undefined ? {} : { note }),
  };
  next.timeline.push({
    ...entryWithoutHash,
    eventHash: stableSha256(entryWithoutHash),
  });
  next.revision = current.revision + 1;
  next.previousStateHash = current.stateHash;
  next.rootCauseAttempts = deriveRootCauseAttempts(next.attemptedCorrections);
  const result = {
    ...next,
    stateHash: stableSha256(next),
  };

  const structure = validateBrandDebugStateStructure(result);
  await validateTrustedReviews(result, structure, trustedRuntime);
  const swapped = await trustedRuntime.commitDebugState({
    taskIdentity: { ...current.taskIdentity },
    expectedRevision: current.revision,
    expectedStateHash: current.stateHash,
    nextState: snapshotStableJson(result, 'next committed debug state'),
  });
  if (swapped !== true) {
    const error = new Error('brand debug state is stale');
    error.code = 'STALE_DEBUG_STATE';
    throw error;
  }
  return deepFreeze(result);
}

function validateBrandDebugStateStructure(input) {
  const state = snapshotStableJson(input, 'brand debug state');
  assertPlain(state, 'brand debug state');
  rejectUnknown(state, STATE_FIELDS, 'brand debug state');
  requireFields(state, STATE_FIELDS, 'brand debug state');
  if (state.schemaVersion !== 1) throw new Error('schemaVersion must be 1');
  validateTaskIdentity(state.taskIdentity);
  const skillId = validateSkillId(state.skillId);
  validateSha256(state.planHash, 'planHash');
  validateSha256(state.evidenceHash, 'evidenceHash');
  const createdAt = validateIso(state.createdAt, 'createdAt');
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) {
    throw new TypeError('revision must be a non-negative safe integer');
  }
  if (state.revision !== state.timeline.length) {
    throw new Error('revision must equal the committed timeline length');
  }
  if (state.revision === 0) {
    if (state.previousStateHash !== null) {
      throw new Error('revision zero previousStateHash must be null');
    }
  } else {
    validateSha256(state.previousStateHash, 'previousStateHash');
  }
  if (!STATUSES.has(state.status)) throw new Error('brand debug status is invalid');
  const { stateHash, ...withoutHash } = state;
  validateSha256(stateHash, 'stateHash');
  if (stateHash !== stableSha256(withoutHash)) {
    throw new Error('brand debug stateHash does not match contents');
  }

  validateAttemptMap(state.rootCauseAttempts, 'rootCauseAttempts', true);
  validateAttemptMap(state.transientAttempts, 'transientAttempts', false);
  if (!Array.isArray(state.attemptedCorrections) || state.attemptedCorrections.length > 300) {
    throw new TypeError('attemptedCorrections must be an array of at most 300');
  }
  const attempts = state.attemptedCorrections.map(
    (attempt, index) => validateAppliedCorrection(
      attempt,
      skillId,
      `attemptedCorrections[${index}]`,
    ),
  );
  const roundIds = new Set();
  const treatmentRounds = {};
  for (const attempt of attempts) {
    if (roundIds.has(attempt.roundId)) throw new Error('roundId must be unique');
    roundIds.add(attempt.roundId);
    const stageIndex = treatmentRounds[attempt.rootCauseFingerprint] ?? 0;
    validateTreatmentStage(attempt, stageIndex);
    treatmentRounds[attempt.rootCauseFingerprint] = stageIndex + 1;
  }
  const expectedRootCauseAttempts = deriveRootCauseAttempts(attempts);
  if (stableStringify(expectedRootCauseAttempts) !== stableStringify(state.rootCauseAttempts)) {
    throw new Error('rootCauseAttempts do not match applied failed rounds');
  }

  let activeCorrection = null;
  if (state.activeCorrection !== null) {
    activeCorrection = validateActiveCorrection(
      state.activeCorrection,
      skillId,
      'activeCorrection',
    );
    if (roundIds.has(activeCorrection.roundId)) {
      throw new Error('active correction roundId was already applied');
    }
    validateTreatmentStage(
      activeCorrection,
      treatmentRounds[activeCorrection.rootCauseFingerprint] ?? 0,
    );
  }
  if ((state.status === 'reworking') !== (activeCorrection !== null)) {
    throw new Error('only reworking state may contain activeCorrection');
  }

  if (!Array.isArray(state.timeline) || state.timeline.length > MAX_TIMELINE_ITEMS) {
    throw new TypeError('timeline must be an array of at most 1000');
  }
  const reviewEntries = [];
  const seenReviewHashes = new Set();
  const reworkEntries = new Map();
  let replayStatus = 'received';
  let previousEventHash = null;
  let previousAt = createdAt;
  let executionReady = false;
  const activeTransients = new Set();
  const replayTransientAttempts = {};
  for (let index = 0; index < state.timeline.length; index += 1) {
    const entry = validateTimelineEntry(state.timeline[index], index);
    if (entry.sequence !== index + 1) throw new Error('timeline sequence is not continuous');
    if (Date.parse(entry.at) < Date.parse(previousAt)) {
      throw new Error('timeline timestamps must be monotonic and at or after createdAt');
    }
    if (entry.previousEventHash !== previousEventHash) {
      throw new Error('timeline previousEventHash chain is broken');
    }
    const { eventHash, ...eventWithoutHash } = entry;
    if (eventHash !== stableSha256(eventWithoutHash)) {
      throw new Error('timeline eventHash does not match event contents');
    }
    if (entry.fromStatus !== replayStatus) {
      throw new Error('timeline fromStatus does not match replay status');
    }
    validateTimelineTransition(entry, {
      executionReady,
      activeTransients,
      transientAttempts: replayTransientAttempts,
    });
    if (entry.eventType === 'execution-ready') executionReady = true;
    if (entry.eventType === 'review-started') executionReady = false;
    if (entry.eventType === 'evidence-ready' || entry.eventType === 'rework-ready') {
      executionReady = false;
    }
    if (entry.eventType === 'transient-failure') {
      const count = (replayTransientAttempts[entry.transientCause] ?? 0) + 1;
      replayTransientAttempts[entry.transientCause] = count;
      activeTransients.add(entry.transientCause);
      if ((count === 3) !== (entry.toStatus === 'blocked')) {
        throw new Error('third transient failure must block');
      }
    }
    if (entry.eventType === 'transient-recovered') {
      if (!activeTransients.has(entry.transientCause)) {
        throw new Error('transient-recovered has no active failure');
      }
      activeTransients.delete(entry.transientCause);
    }
    if (['review-passed', 'review-failed'].includes(entry.eventType)) {
      if (seenReviewHashes.has(entry.reviewHash)) {
        throw new Error('reviewHash must be unique across the timeline');
      }
      seenReviewHashes.add(entry.reviewHash);
      reviewEntries.push(entry);
    }
    if (entry.eventType === 'rework-ready') {
      if (reworkEntries.has(entry.roundId)) throw new Error('rework roundId must be unique');
      reworkEntries.set(entry.roundId, entry);
    }
    replayStatus = entry.toStatus;
    previousAt = entry.at;
    previousEventHash = entry.eventHash;
  }
  if (replayStatus !== state.status) throw new Error('timeline replay status mismatch');
  if (stableStringify(replayTransientAttempts) !== stableStringify(state.transientAttempts)) {
    throw new Error('transientAttempts do not match timeline');
  }
  for (const attempt of attempts) {
    const entry = reworkEntries.get(attempt.roundId);
    if (
      entry === undefined
      || entry.at !== attempt.appliedAt
      || entry.outputCandidateHash !== attempt.outputCandidateHash
      || entry.executionEvidence !== attempt.executionEvidence
    ) {
      throw new Error(`attempt ${attempt.roundId} does not match rework-ready timeline`);
    }
  }
  if (reworkEntries.size !== attempts.length) {
    throw new Error('rework-ready timeline count does not match attemptedCorrections');
  }
  if (activeCorrection !== null) {
    const planningEntry = state.timeline.at(-1);
    if (
      planningEntry?.eventType !== 'review-failed'
      || planningEntry.roundId !== activeCorrection.roundId
      || planningEntry.at !== activeCorrection.plannedAt
      || planningEntry.rootCauseFingerprint !== activeCorrection.rootCauseFingerprint
    ) {
      throw new Error('activeCorrection does not match its review-failed plan');
    }
  }

  validateBlockedReportState(state, attempts);
  return { state, attempts, reviewEntries };
}

async function validateTrustedReviews(state, structure, trustedRuntime) {
  const resolutions = new Map();
  for (const entry of structure.reviewEntries) {
    const resolution = await resolveReview(
      entry.reviewHash,
      state,
      trustedRuntime,
    );
    const { review, diagnostic } = resolution;
    if (
      entry.candidateHash !== review.candidateHash
      || entry.candidateId !== review.candidateId
      || entry.reviewVerdict !== review.verdict
    ) {
      throw new Error('timeline review binding does not match trusted review');
    }
    if (entry.eventType === 'review-passed') {
      if (!['preferred', 'candidate_ready'].includes(review.verdict)) {
        throw new Error('review-passed timeline does not contain a passing review');
      }
    } else {
      if (!['rework', 'eliminated'].includes(review.verdict)) {
        throw new Error('review-failed timeline does not contain a failed review');
      }
      const expectedFingerprint = stableSha256({
        failedCriteria: [...review.failedCriteria].sort(),
        hardVetoes: [...review.hardVetoes].sort(),
        correctionTargets: [...review.correctionTargets].sort(),
        affectedModuleIds: [...diagnostic.affectedModuleIds].sort(),
        skillId: state.skillId,
      });
      if (
        stableStringify(entry.affectedModuleIds)
          !== stableStringify(diagnostic.affectedModuleIds)
        ||
        entry.rootCauseFingerprint !== expectedFingerprint
        || entry.rootCauseCode !== `cause-${expectedFingerprint.slice(0, 16)}`
      ) {
        throw new Error('root cause must be derived from the trusted review');
      }
    }
    resolutions.set(entry.reviewHash, resolution);
  }

  const correctionByRound = new Map(
    structure.attempts.map((attempt) => [attempt.roundId, attempt]),
  );
  if (state.activeCorrection !== null) {
    correctionByRound.set(state.activeCorrection.roundId, state.activeCorrection);
  }
  const reviewedCandidateIds = new Set();
  const reviewedCandidateHashes = new Set();
  const outputCandidateHashes = new Set();
  let pendingAttempt = null;
  for (const entry of state.timeline) {
    if (entry.eventType === 'rework-ready') {
      if (
        reviewedCandidateHashes.has(entry.outputCandidateHash)
        || outputCandidateHashes.has(entry.outputCandidateHash)
      ) {
        throw new Error('candidate lineage requires every output candidate hash to be unique');
      }
      if (pendingAttempt !== null) {
        throw new Error('candidate lineage has an unreviewed output already');
      }
      outputCandidateHashes.add(entry.outputCandidateHash);
      pendingAttempt = correctionByRound.get(entry.roundId);
      if (pendingAttempt === undefined) {
        throw new Error('rework-ready is missing its applied correction');
      }
    }
    if (['review-passed', 'review-failed'].includes(entry.eventType)) {
      const { review, diagnostic } = resolutions.get(entry.reviewHash);
      if (reviewedCandidateIds.has(review.candidateId)) {
        throw new Error('candidateId must be unique across the candidate lineage');
      }
      if (reviewedCandidateHashes.has(review.candidateHash)) {
        throw new Error('review candidate hash must be unique across the candidate lineage');
      }
      if (pendingAttempt !== null) {
        if (review.candidateHash !== pendingAttempt.outputCandidateHash) {
          throw new Error('review candidateHash must equal last unvalidated output');
        }
        const expectedVerdict = entry.eventType === 'review-failed'
          && pendingAttempt.rootCauseFingerprint !== entry.rootCauseFingerprint
          ? 'failed-different-root-cause'
          : review.verdict;
        if (
          pendingAttempt.validatedByReviewHash !== review.reviewHash
          || pendingAttempt.validationVerdict !== expectedVerdict
        ) {
          throw new Error('applied correction validation binding is incomplete');
        }
        pendingAttempt = null;
      }
      reviewedCandidateIds.add(review.candidateId);
      reviewedCandidateHashes.add(review.candidateHash);
      if (entry.eventType === 'review-failed' && entry.roundId !== undefined) {
        const correction = correctionByRound.get(entry.roundId);
        if (
          correction === undefined
          || correction.inputCandidateHash !== review.candidateHash
          || correction.correction
            !== `${correction.treatmentId}: ${diagnostic.correction}`
          || correction.actionHash !== stableSha256(correction.correction)
        ) {
          throw new Error(
            'correction must consume its trusted diagnostic review and action',
          );
        }
      }
    }
  }
  if (pendingAttempt !== null) {
    if (
      pendingAttempt.validatedByReviewHash !== null
      || pendingAttempt.validationVerdict !== null
    ) {
      throw new Error('last unreviewed correction must keep null validation fields');
    }
  }
}

async function resolveReview(reviewHashInput, state, trustedRuntime) {
  const reviewHash = validateSha256(reviewHashInput, 'reviewHash');
  const resolutionInput = await trustedRuntime.resolveReview(reviewHash);
  const resolution = snapshotStableJson(
    resolutionInput,
    `trusted review resolution ${reviewHash}`,
  );
  assertPlain(resolution, 'trusted review resolution');
  rejectUnknown(resolution, REVIEW_RESOLUTION_FIELDS, 'trusted review resolution');
  requireFields(resolution, REVIEW_RESOLUTION_FIELDS, 'trusted review resolution');
  await validateBrandCandidateReview(
    resolution.review,
    resolution.reviewTrustedOptions,
  );
  const review = resolution.review;
  if (review.reviewHash !== reviewHash) throw new Error('trusted resolver returned wrong reviewHash');
  if (
    stableStringify(review.taskIdentity) !== stableStringify(state.taskIdentity)
    || review.skillId !== state.skillId
    || review.planHash !== state.planHash
    || review.evidenceHash !== state.evidenceHash
  ) {
    throw new Error('trusted review does not match debug-state bindings');
  }
  const diagnostic = validateTrustedDiagnostic(
    resolution.diagnostic,
    resolution.reviewTrustedOptions.plan.selectedModuleIds,
    state.skillId,
  );
  return { review, diagnostic };
}

/*
 * Runtime implementations are part of the control-center trust boundary.
 * initializeDebugState and commitDebugState must atomically persist an
 * immutable full-state snapshot. A thrown/false commit must leave the previous
 * stored snapshot intact; Task6 supplies the durable implementation.
 */
function validateTrustedRuntime(runtime) {
  if (utilTypes.isProxy(runtime)) throw new TypeError('trustedRuntime must not be a Proxy');
  assertPlain(runtime, 'trustedRuntime');
  const descriptors = Object.getOwnPropertyDescriptors(runtime);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (
    ownKeys.some((key) => typeof key === 'symbol')
    || ownKeys.length !== RUNTIME_FIELDS.length
  ) {
    throw new TypeError('trustedRuntime must contain exactly four function fields');
  }
  rejectUnknown(runtime, RUNTIME_FIELDS, 'trustedRuntime');
  requireFields(runtime, RUNTIME_FIELDS, 'trustedRuntime');
  for (const field of RUNTIME_FIELDS) {
    const descriptor = descriptors[field];
    if (
      descriptor === undefined
      || descriptor.get !== undefined
      || descriptor.set !== undefined
      || descriptor.enumerable !== true
      || typeof descriptor.value !== 'function'
    ) {
      throw new TypeError(`trustedRuntime.${field} must be an enumerable data function`);
    }
  }
  return runtime;
}

function validateTrustedDiagnostic(input, selectedModuleIds, skillId) {
  assertPlain(input, 'trusted review diagnostic');
  rejectUnknown(input, DIAGNOSTIC_FIELDS, 'trusted review diagnostic');
  requireFields(input, DIAGNOSTIC_FIELDS, 'trusted review diagnostic');
  const affectedModuleIds = validateAffectedModules(
    input.affectedModuleIds,
    skillId,
  );
  if (
    !Array.isArray(selectedModuleIds)
    || affectedModuleIds.some((moduleId) => !selectedModuleIds.includes(moduleId))
  ) {
    throw new Error(
      'trusted review diagnostic affectedModuleIds must belong to plan.selectedModuleIds',
    );
  }
  const correction = validateText(input.correction, 'diagnostic correction', 3800);
  if (typeof input.requiresBusinessDecision !== 'boolean') {
    throw new TypeError('diagnostic requiresBusinessDecision must be boolean');
  }
  const requiresBusinessDecision = input.requiresBusinessDecision;
  const blockedReason = requiresBusinessDecision
    ? validateText(input.blockedReason, 'diagnostic blockedReason', 4000)
    : validateOptionalEmptyText(
      input.blockedReason,
      'diagnostic blockedReason',
      4000,
    );
  const remainingRisks = validateTextList(
    input.remainingRisks,
    'diagnostic remainingRisks',
    requiresBusinessDecision,
  );
  const requestedBusinessInput = validateTextList(
    input.requestedBusinessInput,
    'diagnostic requestedBusinessInput',
    requiresBusinessDecision,
  );
  return {
    affectedModuleIds,
    correction,
    requiresBusinessDecision,
    blockedReason,
    remainingRisks,
    requestedBusinessInput,
  };
}

function validateTimelineEntry(input, index) {
  assertPlain(input, `timeline[${index}]`);
  rejectUnknown(input, TIMELINE_FIELDS, `timeline[${index}]`);
  requireFields(input, [
    'sequence',
    'at',
    'eventType',
    'fromStatus',
    'toStatus',
    'previousEventHash',
    'eventHash',
  ], `timeline[${index}]`);
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) {
    throw new TypeError('timeline sequence is invalid');
  }
  validateIso(input.at, `timeline[${index}].at`);
  if (!EVENT_TYPES.has(input.eventType)) throw new Error('timeline eventType is invalid');
  if (!STATUSES.has(input.fromStatus) || !STATUSES.has(input.toStatus)) {
    throw new Error('timeline status is invalid');
  }
  if (input.previousEventHash !== null) {
    validateSha256(input.previousEventHash, 'timeline previousEventHash');
  }
  validateSha256(input.eventHash, 'timeline eventHash');
  if (Object.hasOwn(input, 'note')) validateText(input.note, 'timeline note', 400);
  const reviewEvent = ['review-passed', 'review-failed'].includes(input.eventType);
  for (const field of ['reviewHash', 'candidateHash', 'candidateId', 'reviewVerdict']) {
    if (reviewEvent !== Object.hasOwn(input, field)) {
      throw new Error(`${input.eventType} timeline review binding is incomplete`);
    }
  }
  if (reviewEvent) {
    validateSha256(input.reviewHash, 'timeline reviewHash');
    validateSha256(input.candidateHash, 'timeline candidateHash');
    safeId(input.candidateId, 'timeline candidateId');
    if (!['preferred', 'candidate_ready', 'rework', 'eliminated'].includes(input.reviewVerdict)) {
      throw new Error('timeline reviewVerdict is invalid');
    }
  }
  if (input.eventType === 'review-failed') {
    requireFields(input, [
      'rootCauseFingerprint',
      'rootCauseCode',
      'affectedModuleIds',
    ], 'review-failed timeline entry');
    validateSha256(input.rootCauseFingerprint, 'rootCauseFingerprint');
    safeId(input.rootCauseCode, 'rootCauseCode');
    validateAffectedModules(input.affectedModuleIds, undefined);
    if (input.toStatus === 'reworking') {
      requireFields(input, ['roundId'], 'review-failed timeline entry');
      safeId(input.roundId, 'roundId');
    }
  }
  if (input.eventType === 'rework-ready') {
    requireFields(input, [
      'roundId',
      'outputCandidateHash',
      'executionEvidence',
    ], 'rework-ready timeline entry');
    safeId(input.roundId, 'roundId');
    validateSha256(input.outputCandidateHash, 'outputCandidateHash');
    validateSha256(input.executionEvidence, 'executionEvidence');
  }
  if (['transient-failure', 'transient-recovered'].includes(input.eventType)) {
    requireFields(input, ['transientCause'], `${input.eventType} timeline entry`);
    safeId(input.transientCause, 'transientCause');
  }
  if (input.toStatus === 'blocked') {
    requireFields(input, ['blockedReportHash'], 'blocked timeline entry');
    validateSha256(input.blockedReportHash, 'blockedReportHash');
  }
  return input;
}

function validateTimelineTransition(entry, replay) {
  const pair = `${entry.fromStatus}->${entry.toStatus}`;
  const expected = {
    'start-planning': 'received->planning',
    'plan-ready': 'planning->collecting_evidence',
    'evidence-ready': 'collecting_evidence->executing',
    'execution-ready': 'executing->executing',
    'review-started': 'executing->reviewing',
    'review-passed': 'reviewing->candidate_ready',
    'rework-ready': 'reworking->executing',
  };
  if (Object.hasOwn(expected, entry.eventType) && pair !== expected[entry.eventType]) {
    throw new Error(`invalid ${entry.eventType} timeline transition`);
  }
  if (
    entry.eventType === 'review-failed'
    && entry.fromStatus !== 'reviewing'
    || entry.eventType === 'review-failed'
      && !['reworking', 'blocked'].includes(entry.toStatus)
  ) {
    throw new Error('invalid review-failed timeline transition');
  }
  if (entry.eventType === 'execution-ready' && replay.executionReady) {
    throw new Error('duplicate execution-ready timeline event');
  }
  if (entry.eventType === 'review-started' && !replay.executionReady) {
    throw new Error('review-started timeline requires execution-ready');
  }
  if (entry.eventType === 'block') {
    if (!BLOCKABLE_STATUSES.has(entry.fromStatus) || entry.toStatus !== 'blocked') {
      throw new Error('invalid block timeline transition');
    }
  }
  if (entry.eventType === 'return-to-control-center') {
    if (
      !['candidate_ready', 'blocked'].includes(entry.fromStatus)
      || entry.toStatus !== 'returned_to_control_center'
    ) throw new Error('invalid return timeline transition');
  }
  if (['transient-failure', 'transient-recovered'].includes(entry.eventType)) {
    if (!TRANSIENT_STATUSES.has(entry.fromStatus)) {
      throw new Error('invalid transient timeline source');
    }
    if (
      entry.eventType === 'transient-recovered'
      && entry.toStatus !== entry.fromStatus
    ) throw new Error('transient-recovered must preserve status');
    if (
      entry.eventType === 'transient-failure'
      && ![entry.fromStatus, 'blocked'].includes(entry.toStatus)
    ) throw new Error('transient-failure has invalid target');
  }
}

function validateActiveCorrection(input, skillId, label) {
  assertPlain(input, label);
  rejectUnknown(input, ACTIVE_CORRECTION_FIELDS, label);
  requireFields(input, ACTIVE_CORRECTION_FIELDS, label);
  safeId(input.roundId, `${label}.roundId`);
  const fingerprint = validateSha256(
    input.rootCauseFingerprint,
    `${label}.rootCauseFingerprint`,
  );
  if (!new RegExp(`^round-${fingerprint.slice(0, 12)}-[1-9]\\d*$`, 'u').test(input.roundId)) {
    throw new Error(`${label}.roundId is not derived from its root cause`);
  }
  if (input.rootCauseCode !== `cause-${fingerprint.slice(0, 16)}`) {
    throw new Error(`${label}.rootCauseCode is not derived`);
  }
  if (!TREATMENT_IDS.includes(input.treatmentId)) {
    throw new Error(`${label}.treatmentId is invalid`);
  }
  validateSha256(input.actionHash, `${label}.actionHash`);
  validateSha256(input.inputCandidateHash, `${label}.inputCandidateHash`);
  validateAffectedModules(input.affectedModuleIds, skillId);
  const correction = validateText(input.correction, `${label}.correction`, 4000);
  if (
    !correction.startsWith(`${input.treatmentId}: `)
    || input.actionHash !== stableSha256(correction)
  ) {
    throw new Error(`${label} action must bind its treatmentId and actionHash`);
  }
  validateIso(input.plannedAt, `${label}.plannedAt`);
  return input;
}

function validateTreatmentStage(correction, stageIndex) {
  const expectedTreatmentId = TREATMENT_IDS[stageIndex];
  if (
    expectedTreatmentId === undefined
    || correction.treatmentId !== expectedTreatmentId
    || correction.roundId !== (
      `round-${correction.rootCauseFingerprint.slice(0, 12)}-${stageIndex + 1}`
    )
  ) {
    throw new Error('correction treatment stage must not repeat or skip');
  }
}

function validateAppliedCorrection(input, skillId, label) {
  assertPlain(input, label);
  rejectUnknown(input, APPLIED_CORRECTION_FIELDS, label);
  requireFields(input, APPLIED_CORRECTION_FIELDS, label);
  validateActiveCorrection(
    Object.fromEntries(ACTIVE_CORRECTION_FIELDS.map((field) => [field, input[field]])),
    skillId,
    label,
  );
  validateIso(input.appliedAt, `${label}.appliedAt`);
  if (Date.parse(input.appliedAt) < Date.parse(input.plannedAt)) {
    throw new Error(`${label}.appliedAt cannot precede plannedAt`);
  }
  validateSha256(input.outputCandidateHash, `${label}.outputCandidateHash`);
  if (input.outputCandidateHash === input.inputCandidateHash) {
    throw new Error(`${label} output candidate must differ from input`);
  }
  validateSha256(input.executionEvidence, `${label}.executionEvidence`);
  const bothNull = input.validatedByReviewHash === null
    && input.validationVerdict === null;
  const bothFilled = typeof input.validatedByReviewHash === 'string'
    && typeof input.validationVerdict === 'string';
  if (!bothNull && !bothFilled) throw new Error(`${label} validation binding is incomplete`);
  if (bothFilled) {
    validateSha256(input.validatedByReviewHash, `${label}.validatedByReviewHash`);
    if (![
      'preferred',
      'candidate_ready',
      'rework',
      'eliminated',
      'failed-different-root-cause',
    ].includes(input.validationVerdict)) {
      throw new Error(`${label}.validationVerdict is invalid`);
    }
  }
  return input;
}

function bindPendingAttempt(next, review, reviewedRootCauseFingerprint) {
  const pending = [...next.attemptedCorrections]
    .reverse()
    .find((attempt) => attempt.validatedByReviewHash === null);
  if (pending === undefined) return;
  if (pending.outputCandidateHash !== review.candidateHash) {
    throw new Error('review candidateHash must equal last unvalidated output');
  }
  pending.validatedByReviewHash = review.reviewHash;
  pending.validationVerdict = (
    reviewedRootCauseFingerprint !== undefined
    && pending.rootCauseFingerprint !== reviewedRootCauseFingerprint
  )
    ? 'failed-different-root-cause'
    : review.verdict;
}

function deriveRootCauseAttempts(attempts) {
  const result = {};
  for (const attempt of attempts) {
    if (['rework', 'eliminated'].includes(attempt.validationVerdict)) {
      result[attempt.rootCauseFingerprint] = (
        result[attempt.rootCauseFingerprint] ?? 0
      ) + 1;
      if (result[attempt.rootCauseFingerprint] > 3) {
        throw new Error('root cause exceeds three applied failed rounds');
      }
    }
  }
  return result;
}

function validateBlockedReportState(state, attempts) {
  if (state.blockedReport === null) {
    if (state.status === 'blocked') throw new Error('blocked state requires blockedReport');
    return;
  }
  const report = validateBlockedReport(state.blockedReport);
  if (!['blocked', 'returned_to_control_center'].includes(state.status)) {
    throw new Error('blockedReport is only allowed after blocking');
  }
  if (
    stableStringify(report.attemptedCorrections)
    !== stableStringify(attempts)
  ) {
    throw new Error(
      'blockedReport attemptedCorrections must exactly match the complete applied history',
    );
  }
  const blockEntry = [...state.timeline].reverse().find(
    (entry) => entry.toStatus === 'blocked',
  );
  if (blockEntry === undefined || blockEntry.blockedReportHash !== stableSha256(report)) {
    throw new Error('blockedReport does not match timeline commitment');
  }
}

function validateBlockedReport(input) {
  assertPlain(input, 'blockedReport');
  rejectUnknown(input, BLOCKED_REPORT_FIELDS, 'blockedReport');
  requireFields(input, BLOCKED_REPORT_FIELDS, 'blockedReport');
  validateText(input.blockedReason, 'blockedReason', 4000);
  if (!Array.isArray(input.attemptedCorrections) || input.attemptedCorrections.length > 300) {
    throw new TypeError('blockedReport attemptedCorrections is invalid');
  }
  validateTextList(input.remainingRisks, 'remainingRisks', true);
  validateTextList(input.requestedBusinessInput, 'requestedBusinessInput', false);
  return input;
}

function buildBlockedReport({
  blockedReason,
  attemptedCorrections,
  remainingRisks,
  requestedBusinessInput,
}) {
  return {
    blockedReason: validateText(blockedReason, 'blockedReason', 4000),
    attemptedCorrections: attemptedCorrections.map(cloneAppliedCorrection),
    remainingRisks: validateTextList(remainingRisks, 'remainingRisks', true),
    requestedBusinessInput: validateTextList(
      requestedBusinessInput,
      'requestedBusinessInput',
      false,
    ),
  };
}

function validateSimpleEvent(event) {
  rejectUnknown(event, ['type', 'note'], `event ${event.type}`);
}

function validateReviewPassedEvent(event) {
  rejectUnknown(event, ['type', 'reviewHash', 'note'], 'review-passed event');
  requireFields(event, ['type', 'reviewHash'], 'review-passed event');
  validateSha256(event.reviewHash, 'reviewHash');
}

function validateReviewFailedEvent(event) {
  rejectUnknown(event, ['type', 'reviewHash', 'note'], 'review-failed event');
  requireFields(
    event,
    ['type', 'reviewHash'],
    'review-failed event',
  );
  validateSha256(event.reviewHash, 'reviewHash');
}

function validateReworkReadyEvent(event) {
  rejectUnknown(event, [
    'type',
    'roundId',
    'outputCandidateHash',
    'executionEvidence',
    'note',
  ], 'rework-ready event');
  requireFields(
    event,
    ['type', 'roundId', 'outputCandidateHash', 'executionEvidence'],
    'rework-ready event',
  );
  safeId(event.roundId, 'roundId');
}

function validateBlockEvent(event) {
  rejectUnknown(event, [
    'type',
    'blockedReason',
    'remainingRisks',
    'requestedBusinessInput',
    'note',
  ], 'block event');
  requireFields(
    event,
    ['type', 'blockedReason', 'remainingRisks', 'requestedBusinessInput'],
    'block event',
  );
}

function validateTransientEvent(event, failure) {
  const allowed = failure
    ? [
      'type',
      'transientCause',
      'blockedReason',
      'remainingRisks',
      'requestedBusinessInput',
      'note',
    ]
    : ['type', 'transientCause', 'note'];
  rejectUnknown(event, allowed, `${event.type} event`);
  requireFields(event, ['type', 'transientCause'], `${event.type} event`);
  safeId(event.transientCause, 'transientCause');
}

function validateAffectedModules(input, skillId) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 5) {
    throw new TypeError('affectedModuleIds must contain 1 to 5 module ids');
  }
  const modules = [...input];
  if (new Set(modules).size !== modules.length) {
    throw new Error('affectedModuleIds must be unique');
  }
  const allModules = new Set(Object.values(BRAND_SKILL_MODULES).flat());
  for (const moduleId of modules) {
    if (!allModules.has(moduleId)) throw new Error(`unknown affected module ${moduleId}`);
    if (skillId !== undefined && !BRAND_SKILL_MODULES[skillId].includes(moduleId)) {
      throw new Error(`${moduleId} does not belong to ${skillId}`);
    }
  }
  return modules.sort();
}

function validateAttemptMap(input, label, fingerprintKeys) {
  assertPlain(input, label);
  if (Object.keys(input).length > 100) throw new Error(`${label} has too many causes`);
  for (const [key, value] of Object.entries(input)) {
    if (fingerprintKeys) validateSha256(key, `${label} key`);
    else safeId(key, `${label} key`);
    if (!Number.isInteger(value) || value < 1 || value > 3) {
      throw new TypeError(`${label}.${key} must be an integer from 1 to 3`);
    }
  }
}

function validateSkillId(value) {
  if (!Object.hasOwn(BRAND_SKILL_MODULES, value)) {
    throw new Error(`unsupported brand skill: ${String(value)}`);
  }
  return value;
}

function validateSha256(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 hash`);
  }
  return value;
}

function validateIso(value, label) {
  if (
    typeof value !== 'string'
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    throw new Error(`${label} must be a canonical ISO date-time`);
  }
  return value;
}

function validateText(value, label, maximum) {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || value.trim() !== value
  ) throw new Error(`${label} must be normalized text of at most ${maximum} characters`);
  return value;
}

function validateOptionalEmptyText(value, label, maximum) {
  if (value === '') return value;
  return validateText(value, label, maximum);
}

function validateTextList(value, label, requireNonempty) {
  if (
    !Array.isArray(value)
    || value.length > 100
    || (requireNonempty && value.length === 0)
  ) throw new TypeError(`${label} must be ${requireNonempty ? 'a nonempty ' : 'an '}array`);
  return value.map((item, index) => validateText(item, `${label}[${index}]`, 2000));
}

function requireStatus(actual, expected, eventType) {
  if (actual !== expected) {
    throw new Error(`${eventType} requires ${expected}, received ${actual}`);
  }
}

function assertReviewHashUnused(current, reviewHash) {
  if (current.timeline.some((entry) => entry.reviewHash === reviewHash)) {
    throw new Error(`reviewHash must be unique and was already used: ${reviewHash}`);
  }
}

function makeReviewBinding(review) {
  return {
    reviewHash: review.reviewHash,
    candidateHash: review.candidateHash,
    candidateId: review.candidateId,
    reviewVerdict: review.verdict,
  };
}

function lastOperationalEvent(state) {
  return [...state.timeline].reverse().find(
    (entry) => !['transient-failure', 'transient-recovered'].includes(entry.eventType),
  )?.eventType;
}

function isTransientActive(timeline, transientCause) {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const entry = timeline[index];
    if (entry.transientCause !== transientCause) continue;
    return entry.eventType === 'transient-failure';
  }
  return false;
}

function cloneCorrection(correction) {
  return {
    ...correction,
    affectedModuleIds: [...correction.affectedModuleIds],
  };
}

function cloneAppliedCorrection(correction) {
  return cloneCorrection(correction);
}

function cloneStateWithoutHash(state) {
  return {
    schemaVersion: state.schemaVersion,
    taskIdentity: { ...state.taskIdentity },
    skillId: state.skillId,
    planHash: state.planHash,
    evidenceHash: state.evidenceHash,
    createdAt: state.createdAt,
    revision: state.revision,
    previousStateHash: state.previousStateHash,
    status: state.status,
    rootCauseAttempts: { ...state.rootCauseAttempts },
    transientAttempts: { ...state.transientAttempts },
    activeCorrection: state.activeCorrection === null
      ? null
      : cloneCorrection(state.activeCorrection),
    attemptedCorrections: state.attemptedCorrections.map(cloneAppliedCorrection),
    timeline: state.timeline.map((entry) => ({
      ...entry,
      ...(entry.affectedModuleIds === undefined
        ? {}
        : { affectedModuleIds: [...entry.affectedModuleIds] }),
    })),
    blockedReport: state.blockedReport === null
      ? null
      : {
        ...state.blockedReport,
        attemptedCorrections: state.blockedReport.attemptedCorrections.map(
          cloneAppliedCorrection,
        ),
        remainingRisks: [...state.blockedReport.remainingRisks],
        requestedBusinessInput: [...state.blockedReport.requestedBusinessInput],
      },
  };
}

function snapshotStableJson(value, label) {
  const budget = { nodes: 0, bytes: 0 };
  return cloneJsonValue(value, label, 0, new Set(), budget);
}

function addBytes(budget, bytes, label) {
  budget.bytes += bytes;
  if (budget.bytes > MAX_JSON_BYTES) {
    throw new Error(`${label} exceeds the 1 MB stable JSON limit`);
  }
}

function cloneJsonValue(value, label, depth, ancestors, budget) {
  budget.nodes += 1;
  if (budget.nodes > MAX_NODES) throw new Error(`${label} exceeds the stable JSON node limit`);
  if (depth > MAX_DEPTH) throw new Error(`${label} exceeds stable JSON depth ${MAX_DEPTH}`);
  if (value === null) {
    addBytes(budget, 4, label);
    return null;
  }
  if (typeof value === 'string') {
    addBytes(budget, Buffer.byteLength(JSON.stringify(value), 'utf8'), label);
    return value;
  }
  if (typeof value === 'boolean') {
    addBytes(budget, value ? 4 : 5, label);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must contain finite numbers`);
    addBytes(budget, Buffer.byteLength(JSON.stringify(value), 'utf8'), label);
    return value;
  }
  if (typeof value !== 'object') throw new TypeError(`${label} must be stable JSON`);
  if (utilTypes.isProxy(value)) throw new TypeError(`${label} must not contain a Proxy`);
  if (ancestors.has(value)) throw new TypeError(`${label} contains a circular reference`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY_LENGTH) throw new Error(`${label} array is too large`);
      addBytes(budget, 2 + Math.max(0, value.length - 1), label);
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const allowedKeys = new Set([
        'length',
        ...Array.from({ length: value.length }, (_, index) => String(index)),
      ]);
      for (const key of Reflect.ownKeys(descriptors)) {
        if (typeof key === 'symbol' || !allowedKeys.has(key)) {
          throw new TypeError(`${label} array has unsupported properties`);
        }
      }
      const result = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (
          descriptor === undefined
          || descriptor.get !== undefined
          || descriptor.set !== undefined
        ) throw new TypeError(`${label} contains a sparse array or accessor`);
        result.push(cloneJsonValue(
          descriptor.value,
          `${label}[${index}]`,
          depth + 1,
          ancestors,
          budget,
        ));
      }
      return result;
    }
    assertPlain(value, label);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).some((key) => typeof key === 'symbol')) {
      throw new TypeError(`${label} must not contain symbol keys`);
    }
    const keys = Object.keys(descriptors);
    if (keys.length > MAX_OBJECT_PROPERTIES) throw new Error(`${label} has too many properties`);
    addBytes(budget, 2 + Math.max(0, keys.length - 1), label);
    const result = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (
        descriptor.enumerable !== true
        || descriptor.get !== undefined
        || descriptor.set !== undefined
      ) throw new TypeError(`${label} has unsupported property descriptors`);
      addBytes(
        budget,
        Buffer.byteLength(JSON.stringify(key), 'utf8') + 1,
        label,
      );
      result[key] = cloneJsonValue(
        descriptor.value,
        `${label}.${key}`,
        depth + 1,
        ancestors,
        budget,
      );
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function rejectUnknown(value, allowed, label) {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unknown !== undefined) throw new Error(`${label} has unknown field: ${unknown}`);
}

function requireFields(value, required, label) {
  const missing = required.find((field) => !Object.hasOwn(value, field));
  if (missing !== undefined) throw new Error(`${label} is missing required field: ${missing}`);
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}
