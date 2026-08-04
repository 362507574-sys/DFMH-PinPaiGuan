import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { types as utilTypes } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  assertPlain,
  rejectUnknown,
  safeId,
  stableSha256,
  stableStringify,
  validateTaskIdentity,
} from './brand_contracts.mjs';
import {
  advanceBrandDebugState,
  createBrandDebugState,
  validateBrandDebugState,
} from './brand_debug_controller.mjs';
import {
  packageBrandDeliverable,
  validateBrandDeliverablePackage,
} from './brand_deliverable_packager.mjs';
import {
  buildBrandEvidenceBundle,
  validateBrandEvidenceBundle,
} from './brand_evidence_engine.mjs';
import {
  evaluateBrandCandidate,
  validateBrandCandidateReview,
} from './brand_quality_gate.mjs';
import {
  createBrandProjectWorkspace,
} from './brand_project_workspace.mjs';
import {
  buildBrandTaskPlan,
  validateBrandTaskPlan,
} from './brand_task_planner.mjs';
import {
  validateBrandCommunicationCandidate,
} from './brand_communication_semantic_validator.mjs';
import {
  validateBrandVisualCandidate,
} from './brand_visual_semantic_validator.mjs';
import {
  writeJsonAtomic,
} from '../../../scripts/feishu-commander/atomic_store.mjs';

const REQUEST_FIELDS = Object.freeze([
  'taskIdentity',
  'skillId',
  'goal',
  'requestedModuleIds',
  'availableInputs',
  'constraints',
  'conversationFacts',
  'publicSources',
  'professionalJudgments',
  'criticalUnknowns',
]);
const TRUSTED_FIELDS = Object.freeze([
  'projectRoot',
  'projectContext',
  'receiptBinding',
  'executeModules',
  'reviewCandidate',
  'reviewerBindings',
  'brandId',
  'visualPolicyContext',
  'now',
  'operationFaultInjector',
]);
const REQUIRED_TRUSTED_FIELDS = Object.freeze([
  'projectRoot',
  'projectContext',
  'receiptBinding',
  'executeModules',
  'reviewCandidate',
  'reviewerBindings',
  'now',
]);
const WORKSPACE_FIELDS = Object.freeze([
  'organizationRoot',
  'taskRoot',
  'planFile',
  'evidenceFile',
  'debugStateFile',
  'candidatesRoot',
  'reviewsRoot',
  'deliverablesRoot',
]);
const REVIEW_CALLBACK_FIELDS = Object.freeze([
  'ruleReview',
  'professionalReview',
  'affectedModuleIds',
  'requiresBusinessDecision',
  'blockedReason',
  'remainingRisks',
  'requestedBusinessInput',
]);
const REVIEW_RECORD_FIELDS = Object.freeze([
  'schemaVersion',
  'review',
  'reviewTrustedOptions',
  'diagnostic',
  'deliveryContext',
  'executionContextCommitment',
  'deliveryContextCommitment',
  'policyContextHash',
]);
const REQUIRED_REVIEW_RECORD_FIELDS = Object.freeze([
  'schemaVersion',
  'review',
  'reviewTrustedOptions',
  'diagnostic',
  'deliveryContext',
  'executionContextCommitment',
  'deliveryContextCommitment',
  'policyContextHash',
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
const CONTEXT_RECORD_FIELDS = Object.freeze([
  'schemaVersion',
  'candidate',
  'deliveryContext',
  'taskIdentity',
  'skillId',
  'planHash',
  'evidenceHash',
  'candidateHash',
  'baseCandidateHash',
  'executionContextCommitment',
  'policyContextHash',
]);
const TASK_LEASE_FIELDS = Object.freeze([
  'schemaVersion',
  'token',
  'pid',
  'createdAt',
  'heartbeatAt',
  'taskIdentity',
  'skillId',
  'policyContextHash',
]);
const DELIVERY_COMMITMENT_FIELD = '_brandDeliveryContextCommitment';
const COMMUNICATION_POLICY_VERSION = 'brand-communication-policy-v1';
const RUNTIME_SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_JSON_FILE_BYTES = 4 * 1024 * 1024;
const MAX_DIRECTORY_JSON_FILES = 1000;
const MAX_SNAPSHOT_DEPTH = 64;
const MAX_SNAPSHOT_NODES = 100_000;
const MAX_SNAPSHOT_ARRAY_LENGTH = 10_000;
const MAX_SNAPSHOT_UTF8_BYTES = 4 * 1024 * 1024;
const TASK_LEASE_STALE_MS = 2_000;
const TASK_LEASE_HEARTBEAT_MS = 500;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const stateLocks = new Map();
const immutableLocks = new Map();

export async function runBrandSkillRuntime(requestValue, trustedOptionsValue) {
  const request = normalizeRequest(requestValue);
  const trusted = normalizeTrustedOptions(trustedOptionsValue, request.skillId);
  const identity = validateTaskIdentity(request.taskIdentity);
  const workspace = await createBrandProjectWorkspace({
    projectRoot: trusted.projectRoot,
    ...identity,
  });
  let policyContextHash = null;
  let policyMigrationIssue = null;
  if (request.skillId === 'brand-visual') {
    policyContextHash = stableSha256({
      brandId: trusted.brandId,
      visualPolicyContext: trusted.visualPolicyContext,
    });
  } else if (request.skillId === 'brand-communication') {
    const binding = await bindCommunicationPolicyContext({
      workspace,
      identity,
    });
    policyContextHash = binding.policyContext.policyContextHash;
    policyMigrationIssue = binding.migrationIssue;
  }
  if (request.skillId === 'brand-visual') {
    await bindVisualPolicyContext({
      workspace,
      identity,
      brandId: trusted.brandId,
      visualPolicyContext: trusted.visualPolicyContext,
      policyContextHash,
    });
  }
  return withTaskExecutionLease({
    workspace,
    identity,
    skillId: request.skillId,
    policyContextHash,
  }, () => runBrandSkillRuntimeUnlocked({
    request,
    trusted: {
      ...trusted,
      policyContextHash,
      policyMigrationIssue,
    },
    identity,
    workspace,
  }));
}

export async function computeBrandCommunicationPolicyContext() {
  const validatorPath = path.join(
    RUNTIME_SCRIPT_DIRECTORY,
    'brand_communication_semantic_validator.mjs',
  );
  const schemaPath = path.resolve(
    RUNTIME_SCRIPT_DIRECTORY,
    '..',
    'contracts',
    'brand-communication-candidate.schema.json',
  );
  const [validatorBytes, schemaBytes] = await Promise.all([
    fs.readFile(validatorPath),
    fs.readFile(schemaPath),
  ]);
  const context = {
    policyVersion: COMMUNICATION_POLICY_VERSION,
    validatorSourceSha256: createHash('sha256')
      .update(validatorBytes)
      .digest('hex'),
    schemaSha256: createHash('sha256')
      .update(schemaBytes)
      .digest('hex'),
  };
  return deepFreeze({
    ...context,
    policyContextHash: stableSha256(context),
  });
}

async function bindCommunicationPolicyContext({ workspace, identity }) {
  const policyContext = await computeBrandCommunicationPolicyContext();
  const expectedRecord = canonicalJsonValue({
    schemaVersion: 1,
    taskIdentity: identity,
    skillId: 'brand-communication',
    ...policyContext,
  });
  const policyPath = boundedChild(
    workspace.taskRoot,
    'communication-policy-context.json',
    'communication policy context binding',
  );
  const existing = await lstatOrNull(policyPath);
  if (existing === null) {
    const priorPlan = await lstatOrNull(workspace.planFile);
    if (priorPlan === null) {
      await writeCanonicalImmutableJson(
        policyPath,
        expectedRecord,
        'communication policy context binding',
      );
      return {
        policyContext,
        migrationIssue: null,
      };
    }
    return {
      policyContext,
      migrationIssue: canonicalJsonValue({
        reason: 'communication policy context is missing for an existing task',
        expectedPolicyContextHash: policyContext.policyContextHash,
        observedFileSha256: null,
      }),
    };
  }
  let observedRecord = null;
  let observedFileSha256 = null;
  let reason = '';
  try {
    await assertRegularFile(
      policyPath,
      'communication policy context binding',
    );
    const bytes = await fs.readFile(policyPath);
    observedFileSha256 = createHash('sha256').update(bytes).digest('hex');
    observedRecord = await readRegularJson(
      policyPath,
      'communication policy context binding',
      64 * 1024,
    );
    await assertCanonicalJsonFile(
      policyPath,
      observedRecord,
      'communication policy context binding',
      64 * 1024,
    );
    if (stableStringify(observedRecord) === stableStringify(expectedRecord)) {
      return {
        policyContext,
        migrationIssue: null,
      };
    }
    reason = 'communication policy context does not match current policy bytes';
  } catch (error) {
    reason = `communication policy context is invalid: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
  return {
    policyContext,
    migrationIssue: canonicalJsonValue({
      reason,
      expectedPolicyContextHash: policyContext.policyContextHash,
      observedFileSha256,
    }),
  };
}

async function bindVisualPolicyContext({
  workspace,
  identity,
  brandId,
  visualPolicyContext,
  policyContextHash,
}) {
  const record = {
    schemaVersion: 1,
    taskIdentity: identity,
    skillId: 'brand-visual',
    brandId,
    visualPolicyContext,
    policyContextHash,
  };
  await writeCanonicalImmutableJson(
    boundedChild(
      workspace.taskRoot,
      'visual-policy-context.json',
      'visual policy context binding',
    ),
    record,
    'visual policy context binding',
  );
}

async function runBrandSkillRuntimeUnlocked({
  request,
  trusted,
  identity,
  workspace,
}) {
  const upstreamArtifacts = snapshotStableJson(
    trusted.projectContext.readableArtifacts,
    'trusted readable artifacts',
  );
  const plan = buildBrandTaskPlan({
    ...identity,
    skillId: request.skillId,
    goal: request.goal,
    requestedModuleIds: request.requestedModuleIds,
    availableInputs: request.availableInputs,
    constraints: request.constraints,
    upstreamArtifacts,
  });
  const evidenceTrustedOptions = {
    projectRoot: trusted.projectRoot,
    projectContext: trusted.projectContext,
    receiptBinding: trusted.receiptBinding,
  };
  const evidenceBundle = await buildBrandEvidenceBundle({
    taskIdentity: { ...identity },
    skillId: request.skillId,
    conversationFacts: request.conversationFacts,
    publicSources: request.publicSources,
    professionalJudgments: request.professionalJudgments,
    requestedUpstreamArtifacts: upstreamArtifacts,
    criticalUnknowns: request.criticalUnknowns,
  }, evidenceTrustedOptions);
  validateBrandTaskPlan(plan);
  await validateBrandEvidenceBundle(evidenceBundle, evidenceTrustedOptions);
  await writeImmutableJson(workspace.planFile, plan);
  await writeImmutableJson(workspace.evidenceFile, evidenceBundle);

  const debugTrustedRuntime = createFileBackedBrandDebugRuntime({ workspace });
  let debugState = await debugTrustedRuntime.readDebugState({ ...identity });
  if (debugState === null) {
    debugState = await createBrandDebugState({
      taskIdentity: { ...identity },
      skillId: plan.skillId,
      planHash: plan.planHash,
      evidenceHash: evidenceBundle.evidenceHash,
      now: nowIso(trusted.now),
    }, debugTrustedRuntime);
  } else {
    await validateBrandDebugState(debugState, debugTrustedRuntime);
    assertDebugBindings(debugState, plan, evidenceBundle);
  }

  if (trusted.policyMigrationIssue !== null) {
    return recordPolicyMigrationRequired({
      workspace,
      plan,
      evidenceBundle,
      debugState,
      policyContextHash: trusted.policyContextHash,
      migrationIssue: trusted.policyMigrationIssue,
    });
  }

  if (debugState.status === 'returned_to_control_center') {
    return restoreTerminalResult({
      workspace,
      plan,
      evidenceBundle,
      debugState,
      debugTrustedRuntime,
      policyContextHash: trusted.policyContextHash,
    });
  }
  if (debugState.status === 'blocked') {
    debugState = await advance(debugState, {
      type: 'return-to-control-center',
    }, trusted.now, debugTrustedRuntime);
    return blockedResult({
      workspace,
      plan,
      evidenceBundle,
      debugState,
      candidate: null,
      review: null,
    });
  }
  if (debugState.status === 'candidate_ready') {
    return finalizeCandidateReady({
      workspace,
      plan,
      evidenceBundle,
      debugState,
      debugTrustedRuntime,
      now: trusted.now,
      policyContextHash: trusted.policyContextHash,
    });
  }
  if (debugState.status === 'received') {
    debugState = await advance(debugState, {
      type: 'start-planning',
    }, trusted.now, debugTrustedRuntime);
  }
  if (debugState.status === 'planning') {
    debugState = await advance(debugState, {
      type: 'plan-ready',
    }, trusted.now, debugTrustedRuntime);
  }

  if (
    debugState.status === 'collecting_evidence'
    && evidenceBundle.blocked
  ) {
    debugState = await advance(debugState, {
      type: 'block',
      blockedReason:
        'Critical evidence is unresolved; module execution is not allowed.',
      remainingRisks: evidenceBundle.criticalUnknowns.map(
        (item) => `${item.criticalField}: ${item.description}`,
      ),
      requestedBusinessInput: evidenceBundle.criticalUnknowns.map(
        (item) => item.description,
      ),
    }, trusted.now, debugTrustedRuntime);
    debugState = await advance(debugState, {
      type: 'return-to-control-center',
    }, trusted.now, debugTrustedRuntime);
    return blockedResult({
      workspace,
      plan,
      evidenceBundle,
      debugState,
      candidate: null,
      review: null,
    });
  }
  if (debugState.status === 'collecting_evidence') {
    debugState = await advance(debugState, {
      type: 'evidence-ready',
    }, trusted.now, debugTrustedRuntime);
  }
  let candidate = null;
  let review = null;
  let deliveryContext;

  while (true) {
    deliveryContext = undefined;
    const correction = debugState.activeCorrection;
    let previousCandidate = candidate;
    let executionContextRecord;
    const persisted = await discoverPersistedCandidates({
      workspace,
      identity,
      skillId: plan.skillId,
      plan,
      evidenceBundle,
      debugState,
      policyContextHash: trusted.policyContextHash,
    });
    if (correction !== null) {
      previousCandidate = persisted.byHash.get(correction.inputCandidateHash)
        ?? previousCandidate;
      if (previousCandidate === null) {
        throw new Error('reworking recovery is missing its input candidate');
      }
    }
    const reusable = selectReusableCandidate({
      debugState,
      persisted,
      correction,
    });
    if (reusable !== null) {
      candidate = reusable;
      executionContextRecord = persisted.contextByHash.get(
        candidate.candidateHash,
      );
      deliveryContext = executionContextRecord?.deliveryContext;
    } else if (debugState.status === 'reviewing') {
      throw new Error('reviewing recovery is missing its persisted candidate');
    } else {
      let executionOutput;
      try {
        executionOutput = (await callJournaledOperation({
          workspace,
          identity,
          plan,
          evidenceBundle,
          stage: 'execute',
          roundId: correction?.roundId ?? null,
          inputAnchor: previousCandidate?.candidateHash ?? null,
          policyContextHash: trusted.policyContextHash,
          callback: trusted.executeModules,
          callbackInput: {
            plan,
            evidenceBundle,
            workspace,
            previousCandidate,
            correction: correction?.correction ?? null,
            roundId: correction?.roundId ?? null,
            treatmentId: correction?.treatmentId ?? null,
          },
          faultInjector: trusted.operationFaultInjector,
        })).value;
      } catch (error) {
        if (error?.code === 'OPERATION_FAULT_INJECTED') throw error;
        const journalFailure = error?.code?.startsWith('OPERATION_');
        const resultFailure = error?.code === 'CALLBACK_RESULT_INVALID';
        return blockCallbackFailure({
          error,
          stage: journalFailure
            ? 'module execution journal'
            : resultFailure
              ? 'module execution result validation'
              : 'module execution',
          code: journalFailure
            ? 'IMMUTABLE_WRITE_FAILED'
            : resultFailure
              ? 'EXECUTE_RESULT_INVALID'
              : 'EXECUTE_CALLBACK_FAILED',
          workspace,
          plan,
          evidenceBundle,
          debugState,
          debugTrustedRuntime,
          now: trusted.now,
          candidate: previousCandidate,
          review,
        });
      }
      try {
        const executionResult = normalizeExecutionResult(
          executionOutput,
          identity,
          plan.skillId,
        );
        const rawCandidate = executionResult.candidate;
        deliveryContext = normalizeRuntimeDeliveryContext(
          executionResult.deliveryContext ?? deriveDeliveryContext({
            candidate: rawCandidate,
            plan,
            diagnostic: null,
          }),
        );
        ({
          candidate,
          executionContextRecord,
        } = anchorCandidateDeliveryContext({
          candidate: rawCandidate,
          deliveryContext,
          plan,
          evidenceBundle,
          policyContextHash: trusted.policyContextHash,
        }));
      } catch (error) {
        return blockCallbackFailure({
          error,
          stage: 'module execution result validation',
          code: 'EXECUTE_RESULT_INVALID',
          workspace,
          plan,
          evidenceBundle,
          debugState,
          debugTrustedRuntime,
          now: trusted.now,
          candidate: previousCandidate,
          review,
        });
      }
    }
    if (
      previousCandidate !== null
      && candidate.candidateHash === previousCandidate.candidateHash
    ) {
      return blockCallbackFailure({
        error: new Error('rework candidate hash did not change'),
        stage: 'module execution',
        workspace,
        plan,
        evidenceBundle,
        debugState,
        debugTrustedRuntime,
        now: trusted.now,
        candidate: previousCandidate,
        review,
      });
    }
    if (plan.skillId === 'brand-visual') {
      try {
        await validateBrandVisualCandidate(
          unanchorVisualCandidate(candidate),
          {
            plan,
            projectRoot: trusted.projectRoot,
            brandId: trusted.brandId,
            visualPolicyContext: trusted.visualPolicyContext,
          },
        );
      } catch (error) {
        return blockCallbackFailure({
          error,
          stage: 'brand visual semantic validation',
          code: 'VISUAL_SEMANTIC_VALIDATION_FAILED',
          workspace,
          plan,
          evidenceBundle,
          debugState,
          debugTrustedRuntime,
          now: trusted.now,
          candidate: previousCandidate,
          review,
        });
      }
    }
    if (plan.skillId === 'brand-communication') {
      try {
        await validateBrandCommunicationCandidate(
          unanchorVisualCandidate(candidate),
          {
            plan,
            evidenceBundle,
            evidenceTrustedOptions,
          },
        );
      } catch (error) {
        return blockCallbackFailure({
          error,
          stage: 'brand communication semantic validation',
          code: 'COMMUNICATION_SEMANTIC_VALIDATION_FAILED',
          workspace,
          plan,
          evidenceBundle,
          debugState,
          debugTrustedRuntime,
          now: trusted.now,
          candidate: previousCandidate,
          review,
        });
      }
    }
    deliveryContext = normalizeRuntimeDeliveryContext(
      deliveryContext ?? deriveDeliveryContext({
        candidate,
        plan,
        diagnostic: null,
      }),
    );
    if (executionContextRecord === undefined) {
      throw new Error('candidate is missing its anchored delivery context');
    }
    await runCodedStage('WORKSPACE_REVALIDATION_FAILED', () => (
      revalidateWorkspace({
        projectRoot: trusted.projectRoot,
        identity,
        workspace,
      })
    ));
    await runCodedStage('IMMUTABLE_WRITE_FAILED', async () => {
      await writeImmutableJson(
        deliveryContextRecordPath(workspace, candidate.candidateId),
        executionContextRecord,
      );
      await writeImmutableJson(
        boundedChild(
          workspace.candidatesRoot,
          `${candidate.candidateId}.json`,
          'candidate file',
        ),
        candidate,
      );
    });
    if (debugState.status === 'reworking' && correction !== null) {
      debugState = await advance(debugState, {
        type: 'rework-ready',
        roundId: correction.roundId,
        outputCandidateHash: candidate.candidateHash,
        executionEvidence: stableSha256({
          roundId: correction.roundId,
          treatmentId: correction.treatmentId,
          actionHash: correction.actionHash,
          outputCandidateHash: candidate.candidateHash,
        }),
      }, trusted.now, debugTrustedRuntime);
    }
    if (
      debugState.status === 'executing'
      && lastOperationalEventType(debugState) !== 'execution-ready'
    ) {
      debugState = await advance(debugState, {
        type: 'execution-ready',
      }, trusted.now, debugTrustedRuntime);
    }
    if (debugState.status === 'executing') {
      debugState = await advance(debugState, {
        type: 'review-started',
      }, trusted.now, debugTrustedRuntime);
    }

    let reviewTrustedOptions;
    let diagnostic;
    let executionContextCommitment;
    let deliveryContextCommitment;
    const persistedReview = await discoverPendingReview({
      workspace,
      candidate,
      debugState,
    });
    if (persistedReview !== null) {
      ({
        review,
        reviewTrustedOptions,
        diagnostic,
        deliveryContext,
        executionContextCommitment,
        deliveryContextCommitment,
      } = persistedReview);
      await validateBrandCandidateReview(review, reviewTrustedOptions);
    } else {
      let callbackReview;
      let reviewOutput;
      let reviewRecord;
      try {
        reviewOutput = (await callJournaledOperation({
          workspace,
          identity,
          plan,
          evidenceBundle,
          stage: 'review',
          roundId: correction?.roundId ?? null,
          inputAnchor: candidate.candidateHash,
          policyContextHash: trusted.policyContextHash,
          callback: trusted.reviewCandidate,
          callbackInput: {
            plan,
            evidenceBundle,
            candidate,
            workspace,
            roundId: correction?.roundId ?? null,
          },
          faultInjector: trusted.operationFaultInjector,
        })).value;
      } catch (error) {
        if (error?.code === 'OPERATION_FAULT_INJECTED') throw error;
        const journalFailure = error?.code?.startsWith('OPERATION_');
        const resultFailure = error?.code === 'CALLBACK_RESULT_INVALID';
        return blockCallbackFailure({
          error,
          stage: journalFailure
            ? 'review operation journal'
            : resultFailure
              ? 'review result validation'
              : 'review callback',
          code: journalFailure
            ? 'IMMUTABLE_WRITE_FAILED'
            : resultFailure
              ? 'REVIEW_RESULT_INVALID'
              : 'REVIEW_CALLBACK_FAILED',
          workspace,
          plan,
          evidenceBundle,
          debugState,
          debugTrustedRuntime,
          now: trusted.now,
          candidate,
          review,
        });
      }
      try {
        callbackReview = normalizeReviewCallback(
          reviewOutput,
          plan.selectedModuleIds,
        );
      } catch (error) {
        return blockCallbackFailure({
          error,
          stage: 'review result validation',
          code: 'REVIEW_RESULT_INVALID',
          workspace,
          plan,
          evidenceBundle,
          debugState,
          debugTrustedRuntime,
          now: trusted.now,
          candidate,
          review,
        });
      }
      try {
        reviewTrustedOptions = {
          plan,
          evidenceBundle,
          evidenceTrustedOptions,
          candidate,
          reviewerBindings: trusted.reviewerBindings,
        };
        review = await evaluateBrandCandidate({
          ruleReview: callbackReview.ruleReview,
          professionalReview: callbackReview.professionalReview,
        }, reviewTrustedOptions);
        await validateBrandCandidateReview(review, reviewTrustedOptions);
      } catch (error) {
        return blockCallbackFailure({
          error,
          stage: 'Task4 review validation',
          code: 'TASK4_VALIDATION_FAILED',
          workspace,
          plan,
          evidenceBundle,
          debugState,
          debugTrustedRuntime,
          now: trusted.now,
          candidate,
          review,
        });
      }
      try {
        diagnostic = {
          affectedModuleIds: callbackReview.affectedModuleIds,
          correction:
            review.correctionTargets.join(' ')
            || 'No correction is required.',
          requiresBusinessDecision: callbackReview.requiresBusinessDecision,
          blockedReason: callbackReview.blockedReason,
          remainingRisks: callbackReview.remainingRisks,
          requestedBusinessInput: callbackReview.requestedBusinessInput,
        };
        deliveryContext = normalizeRuntimeDeliveryContext(
          deliveryContext ?? deriveDeliveryContext({
            candidate,
            plan,
            diagnostic,
          }),
        );
        ({
          executionContextCommitment,
          deliveryContextCommitment,
        } = buildReviewDeliveryCommitments({
          executionContextRecord,
          review,
        }));
        reviewRecord = {
          schemaVersion: 1,
          review,
          reviewTrustedOptions,
          diagnostic,
          deliveryContext,
          executionContextCommitment,
          deliveryContextCommitment,
          policyContextHash: trusted.policyContextHash,
        };
      } catch (error) {
        return blockCallbackFailure({
          error,
          stage: 'review record construction',
          code: 'REVIEW_RECORD_INVALID',
          workspace,
          plan,
          evidenceBundle,
          debugState,
          debugTrustedRuntime,
          now: trusted.now,
          candidate,
          review,
        });
      }
      try {
        await revalidateWorkspace({
          projectRoot: trusted.projectRoot,
          identity,
          workspace,
        });
      } catch (error) {
        return blockCallbackFailure({
          error,
          stage: 'review workspace revalidation',
          code: 'WORKSPACE_REVALIDATION_FAILED',
          workspace,
          plan,
          evidenceBundle,
          debugState,
          debugTrustedRuntime,
          now: trusted.now,
          candidate,
          review,
        });
      }
      try {
        await writeImmutableJson(
          boundedChild(
            workspace.reviewsRoot,
            `${review.reviewHash}.json`,
            'review record',
          ),
          reviewRecord,
        );
      } catch (error) {
        return blockCallbackFailure({
          error,
          stage: 'review immutable write',
          code: 'IMMUTABLE_WRITE_FAILED',
          workspace,
          plan,
          evidenceBundle,
          debugState,
          debugTrustedRuntime,
          now: trusted.now,
          candidate,
          review,
        });
      }
    }
    deliveryContext ??= deriveDeliveryContext({
      candidate,
      plan,
      diagnostic,
    });
    deliveryContext = normalizeRuntimeDeliveryContext(deliveryContext);
    if (
      executionContextCommitment === undefined
      || deliveryContextCommitment === undefined
    ) {
      ({
        executionContextCommitment,
        deliveryContextCommitment,
      } = buildReviewDeliveryCommitments({
        executionContextRecord,
        review,
      }));
    }
    debugState = await advance(debugState, {
      type: ['preferred', 'candidate_ready'].includes(review.verdict)
        ? 'review-passed'
        : 'review-failed',
      reviewHash: review.reviewHash,
    }, trusted.now, debugTrustedRuntime);

    if (debugState.status === 'candidate_ready') {
      const deliverable = await packageBrandDeliverable({
        plan,
        evidenceBundle,
        candidate,
        review,
        debugState,
      }, {
        evidenceTrustedOptions,
        reviewTrustedOptions,
        debugTrustedRuntime,
        deliveryContext,
        baseCandidateHash: executionContextRecord.baseCandidateHash,
        executionContextCommitment,
        deliveryContextCommitment,
        policyContextHash: trusted.policyContextHash,
      });
      await revalidateWorkspace({
        projectRoot: trusted.projectRoot,
        identity,
        workspace,
      });
      await writeImmutableJson(
        boundedChild(
          workspace.deliverablesRoot,
          `${candidate.candidateId}.json`,
          'deliverable file',
        ),
        deliverable,
      );
      debugState = await advance(debugState, {
        type: 'return-to-control-center',
      }, trusted.now, debugTrustedRuntime);
      return successResult({
        workspace,
        plan,
        evidenceBundle,
        candidate,
        review,
        debugState,
        deliverable,
      });
    }
    if (debugState.status === 'blocked') {
      debugState = await advance(debugState, {
        type: 'return-to-control-center',
      }, trusted.now, debugTrustedRuntime);
      return blockedResult({
        workspace,
        plan,
        evidenceBundle,
        debugState,
        candidate,
        review,
      });
    }
  }
}

export function createFileBackedBrandDebugRuntime({
  workspace: workspaceValue,
  atomicWrite = writeJsonAtomic,
} = {}) {
  const workspace = normalizeWorkspace(workspaceValue);
  if (typeof atomicWrite !== 'function') {
    throw new TypeError('atomicWrite must be a function');
  }
  return {
    async resolveReview(reviewHash) {
      validateSha256(reviewHash, 'reviewHash');
      await verifyWorkspaceBoundary(workspace);
      const record = await readRegularJson(
        boundedChild(
          workspace.reviewsRoot,
          `${reviewHash}.json`,
          'review record',
        ),
        'review record',
      );
      validateReviewRecord(record, reviewHash);
      return deepFreeze({
        review: record.review,
        reviewTrustedOptions: record.reviewTrustedOptions,
        diagnostic: record.diagnostic,
      });
    },
    async initializeDebugState({ taskIdentity, state } = {}) {
      const identity = validateTaskIdentity(taskIdentity);
      const snapshot = snapshotStableJson(state, 'initial debug state');
      assertStateIdentity(snapshot, identity);
      await verifyWorkspaceBoundary(workspace);
      return withProcessAndFileLock(
        stateLocks,
        workspace.debugStateFile,
        async () => {
        const existing = await lstatOrNull(workspace.debugStateFile);
        if (existing !== null) return false;
        await atomicWrite(workspace.debugStateFile, snapshot);
        await assertRegularFile(workspace.debugStateFile, 'debug state file');
        return true;
        },
      );
    },
    async readDebugState(taskIdentity) {
      const identity = validateTaskIdentity(taskIdentity);
      await verifyWorkspaceBoundary(workspace);
      const existing = await lstatOrNull(workspace.debugStateFile);
      if (existing === null) return null;
      const state = await readRegularJson(
        workspace.debugStateFile,
        'debug state file',
      );
      assertStateIdentity(state, identity);
      return deepFreeze(state);
    },
    async commitDebugState({
      taskIdentity,
      expectedRevision,
      expectedStateHash,
      nextState,
    } = {}) {
      const identity = validateTaskIdentity(taskIdentity);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        throw new TypeError('expectedRevision must be a non-negative safe integer');
      }
      validateSha256(expectedStateHash, 'expectedStateHash');
      const snapshot = snapshotStableJson(nextState, 'next debug state');
      assertStateIdentity(snapshot, identity);
      await verifyWorkspaceBoundary(workspace);
      return withProcessAndFileLock(
        stateLocks,
        workspace.debugStateFile,
        async () => {
        const current = await readRegularJson(
          workspace.debugStateFile,
          'debug state file',
        );
        if (
          current.revision !== expectedRevision
          || current.stateHash !== expectedStateHash
        ) return false;
        await atomicWrite(workspace.debugStateFile, snapshot);
        await assertRegularFile(workspace.debugStateFile, 'debug state file');
        return true;
        },
      );
    },
  };
}

async function finalizeCandidateReady({
  workspace,
  plan,
  evidenceBundle,
  debugState,
  debugTrustedRuntime,
  now,
  policyContextHash,
}) {
  const entry = [...debugState.timeline].reverse().find(
    (item) => item.eventType === 'review-passed',
  );
  if (entry === undefined) {
    throw new Error('candidate_ready state is missing its passing review');
  }
  const resolution = await debugTrustedRuntime.resolveReview(entry.reviewHash);
  const candidate = resolution.reviewTrustedOptions.candidate;
  const review = resolution.review;
  const contextBinding = await readDeliveryContextForReview({
    workspace,
    reviewHash: review.reviewHash,
    candidate,
    plan,
    diagnostic: resolution.diagnostic,
    policyContextHash,
  });
  const packagingTrusted = {
    evidenceTrustedOptions:
      resolution.reviewTrustedOptions.evidenceTrustedOptions,
    reviewTrustedOptions: resolution.reviewTrustedOptions,
    debugTrustedRuntime,
    ...contextBinding,
  };
  const deliverable = await packageBrandDeliverable({
    plan,
    evidenceBundle,
    candidate,
    review,
    debugState,
  }, packagingTrusted);
  await writeImmutableJson(
    boundedChild(
      workspace.deliverablesRoot,
      `${candidate.candidateId}.json`,
      'deliverable file',
    ),
    deliverable,
  );
  const returned = await advance(debugState, {
    type: 'return-to-control-center',
  }, now, debugTrustedRuntime);
  return successResult({
    workspace,
    plan,
    evidenceBundle,
    candidate,
    review,
    debugState: returned,
    deliverable,
  });
}

async function restoreTerminalResult({
  workspace,
  plan,
  evidenceBundle,
  debugState,
  debugTrustedRuntime,
  policyContextHash,
}) {
  if (debugState.blockedReport !== null) {
    return blockedResult({
      workspace,
      plan,
      evidenceBundle,
      debugState,
      candidate: null,
      review: null,
    });
  }
  const entry = [...debugState.timeline].reverse().find(
    (item) => item.eventType === 'review-passed',
  );
  if (entry === undefined) {
    throw new Error('returned successful state has no passing review');
  }
  const resolution = await debugTrustedRuntime.resolveReview(entry.reviewHash);
  const candidate = resolution.reviewTrustedOptions.candidate;
  const review = resolution.review;
  const storedCandidate = await readRegularJson(
    boundedChild(
      workspace.candidatesRoot,
      `${candidate.candidateId}.json`,
      'candidate file',
    ),
    'candidate file',
  );
  if (stableStringify(candidate) !== stableStringify(storedCandidate)) {
    throw new Error('stored candidate conflicts with passing review');
  }
  const deliverable = await readRegularJson(
    boundedChild(
      workspace.deliverablesRoot,
      `${candidate.candidateId}.json`,
      'deliverable file',
    ),
    'deliverable file',
  );
  validateBrandDeliverablePackage(deliverable);
  const packagedState = JSON.parse(
    deliverable.systemPackage.debugTrace.stateJson,
  );
  if (
    debugState.previousStateHash !== packagedState.stateHash
    || debugState.revision !== packagedState.revision + 1
    || debugState.timeline.length !== packagedState.timeline.length + 1
    || debugState.timeline.at(-1)?.eventType !== 'return-to-control-center'
    || stableStringify(debugState.timeline.slice(0, -1))
      !== stableStringify(packagedState.timeline)
  ) throw new Error('terminal debug state does not extend packaged candidate state');
  const replayRuntime = {
    resolveReview: (reviewHash) => debugTrustedRuntime.resolveReview(reviewHash),
    async initializeDebugState() { return false; },
    async readDebugState() { return structuredClone(packagedState); },
    async commitDebugState() { return false; },
  };
  await validateBrandDebugState(packagedState, replayRuntime);
  const contextBinding = await readDeliveryContextForReview({
    workspace,
    reviewHash: review.reviewHash,
    candidate,
    plan,
    diagnostic: resolution.diagnostic,
    policyContextHash,
  });
  const replayTrusted = {
    evidenceTrustedOptions:
      resolution.reviewTrustedOptions.evidenceTrustedOptions,
    reviewTrustedOptions: resolution.reviewTrustedOptions,
    debugTrustedRuntime: replayRuntime,
    ...contextBinding,
    policyContextHash,
  };
  const replayed = await packageBrandDeliverable({
    plan,
    evidenceBundle,
    candidate,
    review,
    debugState: packagedState,
  }, replayTrusted);
  if (stableStringify(replayed) !== stableStringify(deliverable)) {
    throw new Error('stored deliverable package conflicts with trusted replay');
  }
  return successResult({
    workspace,
    plan,
    evidenceBundle,
    candidate,
    review,
    debugState,
    deliverable,
  });
}

async function blockCallbackFailure({
  error,
  stage,
  code = 'RUNTIME_STAGE_FAILED',
  workspace,
  plan,
  evidenceBundle,
  debugState,
  debugTrustedRuntime,
  now,
  candidate,
  review,
}) {
  const message = error instanceof Error ? error.message : String(error);
  let blocked = await advance(debugState, {
    type: 'block',
    blockedReason: `[${code}] ${stage} failed: ${message}`.slice(0, 4000),
    remainingRisks: [`${stage} did not complete reliably.`],
    requestedBusinessInput: [],
  }, now, debugTrustedRuntime);
  blocked = await advance(blocked, {
    type: 'return-to-control-center',
  }, now, debugTrustedRuntime);
  return blockedResult({
    workspace,
    plan,
    evidenceBundle,
    debugState: blocked,
    candidate,
    review,
  });
}

async function recordPolicyMigrationRequired({
  workspace,
  plan,
  evidenceBundle,
  debugState,
  policyContextHash,
  migrationIssue,
}) {
  const diagnostic = canonicalJsonValue({
    code: 'policy_migration_required',
    blockedReason:
      '[policy_migration_required] communication policy binding changed; old candidate and review records are not reusable.',
    expectedPolicyContextHash: policyContextHash,
    observedFileSha256: migrationIssue.observedFileSha256,
    reason: migrationIssue.reason,
  });
  const audit = canonicalJsonValue({
    schemaVersion: 1,
    taskIdentity: {
      enterpriseId: plan.enterpriseId,
      businessProjectId: plan.businessProjectId,
      taskId: plan.taskId,
    },
    skillId: plan.skillId,
    planHash: plan.planHash,
    evidenceHash: evidenceBundle.evidenceHash,
    diagnostic,
  });
  const auditHash = stableSha256(audit);
  await writeCanonicalImmutableJson(
    boundedChild(
      workspace.taskRoot,
      `communication-policy-migration-required.${auditHash}.json`,
      'communication policy migration audit',
    ),
    audit,
    'communication policy migration audit',
  );
  return deepFreeze({
    status: 'returned_to_control_center',
    outcome: 'blocked',
    deliverablePath: null,
    releaseBoundary: 'organization-candidate-only',
    workspace,
    plan,
    evidenceBundle,
    candidate: null,
    review: null,
    debugState,
    diagnostic,
    deliverable: null,
  });
}

function successResult({
  workspace,
  plan,
  evidenceBundle,
  candidate,
  review,
  debugState,
  deliverable,
}) {
  const deliverablePath = safeDeliverablePath(workspace, candidate.candidateId);
  return deepFreeze({
    status: 'returned_to_control_center',
    outcome: 'candidate_ready',
    deliverablePath,
    releaseBoundary: 'organization-candidate-only',
    workspace,
    plan,
    evidenceBundle,
    candidate,
    review,
    debugState,
    diagnostic: null,
    deliverable,
  });
}

function blockedResult({
  workspace,
  plan,
  evidenceBundle,
  debugState,
  candidate,
  review,
}) {
  return deepFreeze({
    status: 'returned_to_control_center',
    outcome: 'blocked',
    deliverablePath: null,
    releaseBoundary: 'organization-candidate-only',
    workspace,
    plan,
    evidenceBundle,
    candidate,
    review,
    debugState,
    diagnostic: debugState.blockedReport,
    deliverable: null,
  });
}

function safeDeliverablePath(workspace, candidateId) {
  const absolute = boundedChild(
    workspace.deliverablesRoot,
    `${candidateId}.json`,
    'deliverable file',
  );
  const projectRoot = path.resolve(
    workspace.organizationRoot,
    '..',
    '..',
    '..',
    '..',
    '..',
  );
  const relative = path.relative(projectRoot, absolute);
  if (
    relative === ''
    || relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) throw new Error('deliverable path escapes project root');
  const portable = relative.split(path.sep).join('/');
  if (
    !portable.startsWith('business-projects/')
    || portable.includes('/shared-artifacts/')
  ) throw new Error('deliverable path is outside the task candidate boundary');
  return portable;
}

async function advance(state, event, now, runtime) {
  return advanceBrandDebugState({
    current: state,
    event,
    now: nowIso(now),
  }, runtime);
}

function normalizeRequest(value) {
  const request = snapshotStableJson(value, 'brand skill runtime request');
  assertPlain(request, 'brand skill runtime request');
  rejectUnknown(request, REQUEST_FIELDS, 'brand skill runtime request');
  requireFields(request, REQUEST_FIELDS, 'brand skill runtime request');
  validateTaskIdentity(request.taskIdentity);
  return request;
}

function normalizeTrustedOptions(value, skillId) {
  if (utilTypes.isProxy(value)) throw new TypeError('trusted options must not be a Proxy');
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
    ) throw new TypeError(`trusted options ${field} must be an enumerable data field`);
  }
  for (const field of ['executeModules', 'reviewCandidate', 'now']) {
    if (typeof descriptors[field].value !== 'function') {
      throw new TypeError(`trusted options ${field} must be a function`);
    }
  }
  if (typeof descriptors.projectRoot.value !== 'string') {
    throw new TypeError('trusted options projectRoot must be a string');
  }
  const faultDescriptor = descriptors.operationFaultInjector;
  if (
    faultDescriptor !== undefined
    && (
      faultDescriptor.get !== undefined
      || faultDescriptor.set !== undefined
      || faultDescriptor.enumerable !== true
      || typeof faultDescriptor.value !== 'function'
    )
  ) {
    throw new TypeError(
      'trusted options operationFaultInjector must be an enumerable function',
    );
  }
  const isVisual = skillId === 'brand-visual';
  const brandDescriptor = descriptors.brandId;
  const policyDescriptor = descriptors.visualPolicyContext;
  if (isVisual && (brandDescriptor === undefined || policyDescriptor === undefined)) {
    throw new Error(
      'brand-visual trusted options require brandId and visualPolicyContext',
    );
  }
  if (!isVisual && (brandDescriptor !== undefined || policyDescriptor !== undefined)) {
    throw new Error(
      'brandId and visualPolicyContext are only allowed for brand-visual',
    );
  }
  if (isVisual) {
    for (const [field, descriptor] of [
      ['brandId', brandDescriptor],
      ['visualPolicyContext', policyDescriptor],
    ]) {
      if (
        descriptor.get !== undefined
        || descriptor.set !== undefined
        || descriptor.enumerable !== true
      ) {
        throw new TypeError(
          `trusted options ${field} must be an enumerable data field`,
        );
      }
    }
    safeId(brandDescriptor.value, 'trusted options brandId');
  }
  const visualPolicyContext = isVisual
    ? snapshotStableJson(
      policyDescriptor.value,
      'trusted visualPolicyContext',
    )
    : undefined;
  if (isVisual) {
    assertPlain(visualPolicyContext, 'trusted visualPolicyContext');
    rejectUnknown(
      visualPolicyContext,
      ['schemaVersion', 'projectContextVersion', 'commanderTaskId'],
      'trusted visualPolicyContext',
    );
    requireFields(
      visualPolicyContext,
      ['schemaVersion', 'projectContextVersion', 'commanderTaskId'],
      'trusted visualPolicyContext',
    );
    if (visualPolicyContext.schemaVersion !== 1) {
      throw new Error('trusted visualPolicyContext schemaVersion must be 1');
    }
    if (
      !Number.isSafeInteger(visualPolicyContext.projectContextVersion)
      || visualPolicyContext.projectContextVersion < 1
    ) {
      throw new TypeError(
        'trusted visualPolicyContext projectContextVersion must be a positive safe integer',
      );
    }
    safeId(
      visualPolicyContext.commanderTaskId,
      'trusted visualPolicyContext commanderTaskId',
    );
  }
  return {
    projectRoot: descriptors.projectRoot.value,
    projectContext: snapshotStableJson(
      descriptors.projectContext.value,
      'trusted projectContext',
    ),
    receiptBinding: snapshotStableJson(
      descriptors.receiptBinding.value,
      'trusted receiptBinding',
    ),
    executeModules: descriptors.executeModules.value,
    reviewCandidate: descriptors.reviewCandidate.value,
    reviewerBindings: snapshotStableJson(
      descriptors.reviewerBindings.value,
      'trusted reviewerBindings',
    ),
    brandId: isVisual ? brandDescriptor.value : undefined,
    visualPolicyContext,
    now: descriptors.now.value,
    operationFaultInjector: faultDescriptor?.value ?? (async () => {}),
  };
}

function unanchorVisualCandidate(candidate) {
  if (!Object.hasOwn(candidate.content, DELIVERY_COMMITMENT_FIELD)) {
    return candidate;
  }
  const {
    [DELIVERY_COMMITMENT_FIELD]: ignoredCommitment,
    ...baseContent
  } = candidate.content;
  const { candidateHash: ignoredHash, ...withoutHash } = candidate;
  const baseWithoutHash = {
    ...withoutHash,
    content: baseContent,
  };
  return {
    ...baseWithoutHash,
    candidateHash: stableSha256(baseWithoutHash),
  };
}

function normalizeReviewCallback(value, selectedModuleIds) {
  const result = snapshotStableJson(value, 'review callback result');
  assertPlain(result, 'review callback result');
  rejectUnknown(result, REVIEW_CALLBACK_FIELDS, 'review callback result');
  requireFields(
    result,
    ['ruleReview', 'professionalReview'],
    'review callback result',
  );
  const affectedModuleIds = result.affectedModuleIds ?? [...selectedModuleIds];
  if (
    !Array.isArray(affectedModuleIds)
    || affectedModuleIds.length === 0
    || affectedModuleIds.some((moduleId) => !selectedModuleIds.includes(moduleId))
    || new Set(affectedModuleIds).size !== affectedModuleIds.length
  ) {
    throw new Error(
      'review callback affectedModuleIds must be selected modules',
    );
  }
  const requiresBusinessDecision = result.requiresBusinessDecision ?? false;
  if (typeof requiresBusinessDecision !== 'boolean') {
    throw new TypeError('requiresBusinessDecision must be boolean');
  }
  const blockedReason = normalizeOptionalText(
    result.blockedReason ?? '',
    'blockedReason',
  );
  const remainingRisks = normalizeTextArray(
    result.remainingRisks ?? [],
    'remainingRisks',
  );
  const requestedBusinessInput = normalizeTextArray(
    result.requestedBusinessInput ?? [],
    'requestedBusinessInput',
  );
  if (
    requiresBusinessDecision
    && (
      blockedReason === ''
      || remainingRisks.length === 0
      || requestedBusinessInput.length === 0
    )
  ) {
    throw new Error(
      'business decision review requires reason, risks, and requested input',
    );
  }
  return {
    ruleReview: result.ruleReview,
    professionalReview: result.professionalReview,
    affectedModuleIds: [...affectedModuleIds].sort(),
    requiresBusinessDecision,
    blockedReason,
    remainingRisks,
    requestedBusinessInput,
  };
}

function normalizeExecutionResult(value, identity, skillId) {
  const snapshot = snapshotStableJson(value, 'module execution result');
  if (
    snapshot !== null
    && typeof snapshot === 'object'
    && !Array.isArray(snapshot)
    && Object.hasOwn(snapshot, 'candidate')
  ) {
    assertPlain(snapshot, 'module execution result');
    rejectUnknown(
      snapshot,
      ['candidate', 'deliveryContext'],
      'module execution result',
    );
    requireFields(snapshot, ['candidate'], 'module execution result');
    return {
      candidate: validateCandidate(snapshot.candidate, identity, skillId),
      deliveryContext: Object.hasOwn(snapshot, 'deliveryContext')
        ? snapshot.deliveryContext
        : undefined,
    };
  }
  return {
    candidate: validateCandidate(snapshot, identity, skillId),
    deliveryContext: undefined,
  };
}

function deriveDeliveryContext({ candidate, plan, diagnostic }) {
  let conclusion = null;
  if (Array.isArray(candidate.content?.sections)) {
    conclusion = candidate.content.sections.find(
      (item) => typeof item?.content === 'string'
        && item.content.trim() !== '',
    )?.content ?? null;
  }
  for (const field of ['businessConclusion', 'conclusion', 'summary']) {
    if (conclusion === null && typeof candidate.content?.[field] === 'string') {
      conclusion = candidate.content[field];
    }
  }
  if (
    conclusion === null
    && typeof candidate.content?.messageHierarchy?.coreMessage?.claim === 'string'
  ) {
    conclusion = candidate.content.messageHierarchy.coreMessage.claim;
  }
  conclusion ??= stableStringify(candidate.content);
  conclusion = conclusion.trim().slice(0, 10000);
  return {
    businessConclusion: conclusion,
    recommendedCandidate: candidate.candidateId,
    confirmedConclusions: [conclusion],
    riskNotes: [...(diagnostic?.remainingRisks ?? [])],
    decisionRequests: [...(diagnostic?.requestedBusinessInput ?? [])],
    mustPreserve: [...plan.acceptanceCriteria],
    mayAdapt: [],
    forbiddenChanges: [...plan.stopConditions],
    nextOrganizationRecommendation: null,
  };
}

function normalizeRuntimeDeliveryContext(value) {
  const result = snapshotStableJson(value, 'trusted delivery context');
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
  assertPlain(result, 'trusted delivery context');
  rejectUnknown(result, fields, 'trusted delivery context');
  requireFields(result, fields, 'trusted delivery context');
  for (const field of ['businessConclusion', 'recommendedCandidate']) {
    if (
      typeof result[field] !== 'string'
      || result[field].trim() !== result[field]
      || result[field].length === 0
      || result[field].length > 10000
    ) throw new TypeError(`trusted delivery context ${field} is invalid`);
  }
  for (const [field, minimum] of [
    ['confirmedConclusions', 1],
    ['riskNotes', 0],
    ['decisionRequests', 0],
    ['mustPreserve', 1],
    ['mayAdapt', 0],
    ['forbiddenChanges', 1],
  ]) {
    const normalized = normalizeTextArray(
      result[field],
      `trusted delivery context ${field}`,
    );
    if (normalized.length < minimum) {
      throw new Error(`trusted delivery context ${field} is incomplete`);
    }
    result[field] = normalized;
  }
  if (result.nextOrganizationRecommendation !== null) {
    assertPlain(
      result.nextOrganizationRecommendation,
      'next organization recommendation',
    );
    rejectUnknown(
      result.nextOrganizationRecommendation,
      ['organizationId', 'reason'],
      'next organization recommendation',
    );
    requireFields(
      result.nextOrganizationRecommendation,
      ['organizationId', 'reason'],
      'next organization recommendation',
    );
    safeId(
      result.nextOrganizationRecommendation.organizationId,
      'next organizationId',
    );
    normalizeOptionalText(
      result.nextOrganizationRecommendation.reason,
      'next organization reason',
    );
    if (result.nextOrganizationRecommendation.reason.length === 0) {
      throw new Error('next organization reason must not be empty');
    }
  }
  return result;
}

function deliveryContextRecordPath(workspace, candidateId) {
  safeId(candidateId, 'delivery context candidateId');
  return boundedChild(
    workspace.candidatesRoot,
    `${candidateId}.delivery-context.json`,
    'delivery context record',
  );
}

function executionContextCommitmentPayload({
  deliveryContext,
  baseCandidateHash,
  taskIdentity,
  skillId,
  planHash,
  evidenceHash,
  policyContextHash,
}) {
  return {
    deliveryContext,
    baseCandidateHash,
    taskIdentity,
    skillId,
    planHash,
    evidenceHash,
    ...(policyContextHash === null
      ? {}
      : { policyContextHash }),
  };
}

function anchorCandidateDeliveryContext({
  candidate,
  deliveryContext,
  plan,
  evidenceBundle,
  policyContextHash,
}) {
  if (Object.hasOwn(candidate.content, DELIVERY_COMMITMENT_FIELD)) {
    throw new Error(
      'candidate content contains the reserved delivery context commitment field',
    );
  }
  const baseCandidateHash = candidate.candidateHash;
  const taskIdentity = {
    enterpriseId: plan.enterpriseId,
    businessProjectId: plan.businessProjectId,
    taskId: plan.taskId,
  };
  const payload = executionContextCommitmentPayload({
    deliveryContext,
    baseCandidateHash,
    taskIdentity,
    skillId: plan.skillId,
    planHash: plan.planHash,
    evidenceHash: evidenceBundle.evidenceHash,
    policyContextHash,
  });
  const executionContextCommitment = stableSha256(payload);
  const { candidateHash: ignoredCandidateHash, ...candidateWithoutHash } =
    candidate;
  const anchoredWithoutHash = {
    ...candidateWithoutHash,
    content: {
      ...candidate.content,
      [DELIVERY_COMMITMENT_FIELD]: executionContextCommitment,
    },
  };
  const anchoredCandidate = deepFreeze({
    ...anchoredWithoutHash,
    candidateHash: stableSha256(anchoredWithoutHash),
  });
  const record = canonicalJsonValue({
    schemaVersion: 1,
    candidate: anchoredCandidate,
    ...payload,
    policyContextHash,
    candidateHash: anchoredCandidate.candidateHash,
    executionContextCommitment,
  });
  if (
    Buffer.byteLength(`${JSON.stringify(record, null, 2)}\n`, 'utf8')
      > 1024 * 1024
  ) throw new Error('delivery context record exceeds the 1 MiB byte budget');
  return {
    candidate: anchoredCandidate,
    executionContextRecord: deepFreeze(record),
  };
}

function buildReviewDeliveryCommitments({ executionContextRecord, review }) {
  return {
    executionContextCommitment:
      executionContextRecord.executionContextCommitment,
    deliveryContextCommitment: stableSha256({
      ...executionContextCommitmentPayload(executionContextRecord),
      candidateHash: executionContextRecord.candidateHash,
      reviewHash: review.reviewHash,
      executionContextCommitment:
        executionContextRecord.executionContextCommitment,
    }),
  };
}

function canonicalJsonValue(value) {
  return JSON.parse(stableStringify(value));
}

async function callJournaledOperation({
  workspace,
  identity,
  plan,
  evidenceBundle,
  stage,
  roundId,
  inputAnchor,
  policyContextHash,
  callback,
  callbackInput,
  faultInjector,
}) {
  const operationsRoot = boundedChild(
    workspace.taskRoot,
    'operations',
    'operation journal directory',
  );
  try {
    await ensureProtectedDirectory(operationsRoot, workspace.taskRoot);
  } catch (error) {
    throw taggedStageError('OPERATION_JOURNAL_BOUNDARY_FAILED', error);
  }
  const binding = canonicalJsonValue({
    taskIdentity: identity,
    skillId: plan.skillId,
    planHash: plan.planHash,
    evidenceHash: evidenceBundle.evidenceHash,
    stage,
    roundId,
    inputAnchor,
    policyContextHash,
  });
  const digest = stableSha256({
    schemaVersion: 1,
    ...binding,
  });
  const operation = deepFreeze({
    operationId: `brand-${stage}-${digest.slice(0, 32)}`,
    idempotencyKey: `brand-runtime-v1:${digest}`,
    deliverySemantics: 'at-least-once',
  });
  const recordBase = canonicalJsonValue({
    schemaVersion: 1,
    operation,
    binding,
  });
  const intentPath = boundedChild(
    operationsRoot,
    `${operation.operationId}.intent.json`,
    'operation intent',
  );
  const completionPath = boundedChild(
    operationsRoot,
    `${operation.operationId}.completion.json`,
    'operation completion',
  );
  try {
    await writeCanonicalImmutableJson(intentPath, {
      ...recordBase,
      recordType: 'intent',
    }, 'operation intent');
  } catch (error) {
    throw taggedStageError('OPERATION_INTENT_WRITE_FAILED', error);
  }
  const existing = await lstatOrNull(completionPath);
  if (existing !== null) {
    let completion;
    try {
      completion = await readOperationRecord(
        completionPath,
        recordBase,
        'operation completion',
      );
    } catch (error) {
      throw taggedStageError('OPERATION_COMPLETION_INVALID', error);
    }
    return {
      value: completion.output,
      operation,
      replayed: true,
    };
  }
  let callbackValue;
  try {
    callbackValue = await callback(deepFreeze({
      ...callbackInput,
      operation,
    }));
  } catch (error) {
    throw taggedStageError('CALLBACK_FAILED', error);
  }
  let output;
  try {
    output = snapshotStableJson(callbackValue, `${stage} callback result`);
  } catch (error) {
    throw taggedStageError('CALLBACK_RESULT_INVALID', error);
  }
  try {
    await faultInjector(deepFreeze({
      stage,
      operation,
      taskIdentity: { ...identity },
    }));
  } catch (cause) {
    const error = new Error(
      cause instanceof Error ? cause.message : String(cause),
      { cause },
    );
    error.code = 'OPERATION_FAULT_INJECTED';
    throw error;
  }
  const completion = canonicalJsonValue({
    ...recordBase,
    recordType: 'completion',
    output,
    outputHash: stableSha256(output),
  });
  try {
    await writeCanonicalImmutableJson(
      completionPath,
      completion,
      'operation completion',
    );
  } catch (error) {
    throw taggedStageError('OPERATION_COMPLETION_WRITE_FAILED', error);
  }
  return {
    value: output,
    operation,
    replayed: false,
  };
}

function taggedStageError(code, cause) {
  const error = new Error(
    cause instanceof Error ? cause.message : String(cause),
    { cause },
  );
  error.code = code;
  return error;
}

async function runCodedStage(code, operation) {
  try {
    return await operation();
  } catch (error) {
    throw taggedStageError(code, error);
  }
}

async function readOperationRecord(filePath, recordBase, label) {
  const record = await readRegularJson(filePath, label, MAX_JSON_FILE_BYTES);
  await assertCanonicalJsonFile(filePath, record, label, MAX_JSON_FILE_BYTES);
  assertPlain(record, label);
  rejectUnknown(record, [
    'schemaVersion',
    'operation',
    'binding',
    'recordType',
    'output',
    'outputHash',
  ], label);
  requireFields(record, [
    'schemaVersion',
    'operation',
    'binding',
    'recordType',
    'output',
    'outputHash',
  ], label);
  if (
    record.recordType !== 'completion'
    || stableStringify(record.operation) !== stableStringify(recordBase.operation)
    || stableStringify(record.binding) !== stableStringify(recordBase.binding)
    || record.outputHash !== stableSha256(record.output)
  ) throw new Error(`${label} binding or output hash is invalid`);
  return record;
}

async function writeCanonicalImmutableJson(filePath, value, label) {
  const canonical = canonicalJsonValue(value);
  const bytes = Buffer.byteLength(
    `${JSON.stringify(canonical, null, 2)}\n`,
    'utf8',
  );
  if (bytes > MAX_JSON_FILE_BYTES) {
    throw new Error(`${label} exceeds the JSON byte budget`);
  }
  await writeImmutableJson(filePath, canonical);
  const stored = await fs.readFile(filePath);
  const expected = Buffer.from(
    `${JSON.stringify(canonical, null, 2)}\n`,
    'utf8',
  );
  if (!stored.equals(expected)) throw new Error(`${label} bytes are not canonical`);
}

async function ensureProtectedDirectory(directoryPath, parentPath) {
  assertInside(parentPath, directoryPath, 'protected directory');
  await fs.mkdir(directoryPath, { recursive: true });
  const info = await fs.lstat(directoryPath);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('protected directory must not be a symbolic link');
  }
  if (await fs.realpath(directoryPath) !== path.resolve(directoryPath)) {
    throw new Error('protected directory contains a symbolic link or junction');
  }
}

async function readExecutionContextRecord(filePath, {
  identity,
  skillId,
  plan,
  evidenceBundle,
  policyContextHash,
}) {
  await assertRegularFile(filePath, 'delivery context record');
  if (await fs.realpath(filePath) !== path.resolve(filePath)) {
    throw new Error('delivery context record must not contain a symbolic link');
  }
  const bytes = await fs.readFile(filePath);
  if (bytes.length > 1024 * 1024) {
    throw new Error('delivery context record exceeds the 1 MiB byte budget');
  }
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`delivery context record JSON is invalid: ${error.message}`, {
      cause: error,
    });
  }
  const canonical = canonicalJsonValue(parsed);
  const expectedBytes = Buffer.from(
    `${JSON.stringify(canonical, null, 2)}\n`,
    'utf8',
  );
  if (!bytes.equals(expectedBytes)) {
    throw new Error('delivery context record bytes are not canonical');
  }
  assertPlain(canonical, 'delivery context record');
  rejectUnknown(
    canonical,
    CONTEXT_RECORD_FIELDS,
    'delivery context record',
  );
  requireFields(
    canonical,
    CONTEXT_RECORD_FIELDS,
    'delivery context record',
  );
  if (canonical.schemaVersion !== 1) {
    throw new Error('delivery context record schemaVersion must be 1');
  }
  const candidate = validateCandidate(canonical.candidate, identity, skillId);
  const deliveryContext = normalizeRuntimeDeliveryContext(
    canonical.deliveryContext,
  );
  validateSha256(canonical.baseCandidateHash, 'baseCandidateHash');
  if (
    candidate.content[DELIVERY_COMMITMENT_FIELD]
      !== canonical.executionContextCommitment
  ) {
    throw new Error(
      'candidate delivery context commitment anchor does not match sidecar',
    );
  }
  const {
    [DELIVERY_COMMITMENT_FIELD]: reservedCommitment,
    ...baseContent
  } = candidate.content;
  const { candidateHash: anchoredHash, ...anchoredWithoutHash } = candidate;
  const baseCandidateWithoutHash = {
    ...anchoredWithoutHash,
    content: baseContent,
  };
  if (stableSha256(baseCandidateWithoutHash) !== canonical.baseCandidateHash) {
    throw new Error('candidate base content identity does not match sidecar');
  }
  if (
    stableStringify(canonical.taskIdentity) !== stableStringify(identity)
    || canonical.skillId !== skillId
    || canonical.planHash !== plan.planHash
    || canonical.evidenceHash !== evidenceBundle.evidenceHash
    || canonical.candidateHash !== candidate.candidateHash
    || canonical.policyContextHash !== policyContextHash
  ) throw new Error('delivery context record binding does not match task');
  const expectedCommitment = stableSha256(
    executionContextCommitmentPayload(canonical),
  );
  if (canonical.executionContextCommitment !== expectedCommitment) {
    throw new Error('execution delivery context commitment does not match bytes');
  }
  return deepFreeze({
    ...canonical,
    candidate,
    deliveryContext,
  });
}

async function discoverPersistedCandidates({
  workspace,
  identity,
  skillId,
  plan,
  evidenceBundle,
  debugState,
  policyContextHash,
}) {
  await verifyWorkspaceBoundary(workspace);
  const directoryNames = await fs.readdir(workspace.candidatesRoot);
  assertJsonDirectoryBudget(directoryNames, 'candidate directory');
  const names = directoryNames
    .filter((name) => (
      name.endsWith('.json')
      && !name.endsWith('.delivery-context.json')
    ))
    .sort();
  const candidates = [];
  const byHash = new Map();
  const contextByHash = new Map();
  const candidateFileHashes = new Set();
  const reviewedHashes = new Set(
    debugState.timeline
      .filter((entry) => [
        'review-passed',
        'review-failed',
      ].includes(entry.eventType))
      .map((entry) => entry.candidateHash),
  );
  for (const name of names) {
    const filePath = boundedChild(
      workspace.candidatesRoot,
      name,
      'candidate file',
    );
    const candidate = validateCandidate(
      await readRegularJson(filePath, 'candidate file'),
      identity,
      skillId,
    );
    if (`${candidate.candidateId}.json` !== name) {
      throw new Error('candidate filename does not match candidateId');
    }
    if (byHash.has(candidate.candidateHash)) {
      throw new Error('persisted candidate hash is duplicated');
    }
    byHash.set(candidate.candidateHash, candidate);
    candidateFileHashes.add(candidate.candidateHash);
    candidates.push(candidate);
  }
  for (const name of directoryNames
    .filter((item) => item.endsWith('.delivery-context.json'))
    .sort()) {
    const record = await readExecutionContextRecord(
      boundedChild(workspace.candidatesRoot, name, 'delivery context record'),
      {
        identity,
        skillId,
        plan,
        evidenceBundle,
        policyContextHash,
      },
    );
    if (`${record.candidate.candidateId}.delivery-context.json` !== name) {
      throw new Error('delivery context filename does not match candidateId');
    }
    const existing = byHash.get(record.candidateHash);
    if (
      existing !== undefined
      && stableStringify(existing) !== stableStringify(record.candidate)
    ) throw new Error('delivery context candidate conflicts with candidate file');
    if (contextByHash.has(record.candidateHash)) {
      throw new Error('delivery context candidateHash is duplicated');
    }
    if (existing === undefined) {
      byHash.set(record.candidateHash, record.candidate);
      candidates.push(record.candidate);
    }
    contextByHash.set(record.candidateHash, record);
  }
  for (const candidateHash of candidateFileHashes) {
    if (!contextByHash.has(candidateHash)) {
      throw new Error(
        'persisted candidate is missing its delivery context sidecar',
      );
    }
  }
  return {
    candidates,
    byHash,
    contextByHash,
    unreviewed: candidates.filter(
      (candidate) => !reviewedHashes.has(candidate.candidateHash),
    ),
  };
}

function selectReusableCandidate({ debugState, persisted, correction }) {
  if (debugState.status === 'reviewing') {
    return exactlyOneOrNull(
      persisted.unreviewed,
      'reviewing persisted candidate',
      true,
    );
  }
  if (debugState.status === 'reworking') {
    return exactlyOneOrNull(
      persisted.unreviewed.filter(
        (candidate) => candidate.candidateHash
          !== correction.inputCandidateHash,
      ),
      'reworking persisted output',
      false,
    );
  }
  if (debugState.status !== 'executing') return null;
  const last = lastOperationalEventType(debugState);
  if (last === 'rework-ready') {
    const outputHash = [...debugState.timeline].reverse().find(
      (entry) => entry.eventType === 'rework-ready',
    )?.outputCandidateHash;
    return persisted.byHash.get(outputHash) ?? null;
  }
  return exactlyOneOrNull(
    persisted.unreviewed,
    'executing persisted output',
    last === 'execution-ready',
  );
}

function exactlyOneOrNull(values, label, required) {
  if (values.length > 1) throw new Error(`${label} is ambiguous`);
  if (values.length === 0) {
    if (required) throw new Error(`${label} is missing`);
    return null;
  }
  return values[0];
}

function lastOperationalEventType(state) {
  return [...state.timeline].reverse().find(
    (entry) => !['transient-failure', 'transient-recovered'].includes(
      entry.eventType,
    ),
  )?.eventType ?? null;
}

async function discoverPendingReview({ workspace, candidate, debugState }) {
  const used = new Set(
    debugState.timeline
      .map((entry) => entry.reviewHash)
      .filter((value) => value !== undefined && value !== null),
  );
  const matches = [];
  const directoryNames = await fs.readdir(workspace.reviewsRoot);
  assertJsonDirectoryBudget(directoryNames, 'review directory');
  for (const name of directoryNames
    .filter((item) => item.endsWith('.json'))
    .sort()) {
    const expectedHash = name.slice(0, -'.json'.length);
    const record = await readRegularJson(
      boundedChild(workspace.reviewsRoot, name, 'review record'),
      'review record',
    );
    validateReviewRecord(record, expectedHash);
    if (
      !used.has(record.review.reviewHash)
      && record.review.candidateHash === candidate.candidateHash
    ) matches.push(record);
  }
  if (matches.length > 1) throw new Error('persisted pending review is ambiguous');
  if (matches.length === 0) return null;
  const trustedContext = await resolveReviewDeliveryContextRecord({
    workspace,
    record: matches[0],
  });
  return {
    review: matches[0].review,
    reviewTrustedOptions: matches[0].reviewTrustedOptions,
    diagnostic: matches[0].diagnostic,
    ...trustedContext,
  };
}

function assertJsonDirectoryBudget(names, label) {
  const jsonCount = names.filter((name) => name.endsWith('.json')).length;
  if (jsonCount > MAX_DIRECTORY_JSON_FILES) {
    throw new Error(`${label} exceeds the JSON file-count budget`);
  }
}

async function readDeliveryContextForReview({
  workspace,
  reviewHash,
  candidate,
  plan,
  diagnostic,
  policyContextHash,
}) {
  const record = await readRegularJson(
    boundedChild(
      workspace.reviewsRoot,
      `${reviewHash}.json`,
      'review record',
    ),
    'review record',
  );
  validateReviewRecord(record, reviewHash);
  return resolveReviewDeliveryContextRecord({
    workspace,
    record,
    policyContextHash,
  });
}

async function resolveReviewDeliveryContextRecord({
  workspace,
  record,
  policyContextHash = record.policyContextHash,
}) {
  const { plan, evidenceBundle } = record.reviewTrustedOptions;
  const identity = {
    enterpriseId: plan.enterpriseId,
    businessProjectId: plan.businessProjectId,
    taskId: plan.taskId,
  };
  const executionRecord = await readExecutionContextRecord(
    deliveryContextRecordPath(workspace, record.review.candidateId),
    {
      identity,
      skillId: plan.skillId,
      plan,
      evidenceBundle,
      policyContextHash,
    },
  );
  if (
    record.policyContextHash !== policyContextHash
    || stableStringify(record.deliveryContext)
      !== stableStringify(executionRecord.deliveryContext)
  ) {
    throw new Error(
      'review delivery context conflicts with trusted persisted context',
    );
  }
  const expected = buildReviewDeliveryCommitments({
    executionContextRecord: executionRecord,
    review: record.review,
  });
  if (
    record.executionContextCommitment
      !== expected.executionContextCommitment
    || record.deliveryContextCommitment
      !== expected.deliveryContextCommitment
  ) throw new Error('review delivery context commitment is invalid');
  return {
    deliveryContext: executionRecord.deliveryContext,
    baseCandidateHash: executionRecord.baseCandidateHash,
    policyContextHash,
    ...expected,
  };
}

function validateCandidate(value, identity, skillId) {
  const candidate = snapshotStableJson(value, 'candidate');
  assertPlain(candidate, 'candidate');
  rejectUnknown(candidate, CANDIDATE_FIELDS, 'candidate');
  requireFields(candidate, CANDIDATE_FIELDS, 'candidate');
  safeId(candidate.candidateId, 'candidate candidateId');
  for (const field of ['enterpriseId', 'businessProjectId', 'taskId']) {
    safeId(candidate[field], `candidate ${field}`);
    if (candidate[field] !== identity[field]) {
      throw new Error(`candidate ${field} does not match task`);
    }
  }
  if (candidate.skillId !== skillId) {
    throw new Error('candidate skillId does not match plan');
  }
  assertPlain(candidate.content, 'candidate content');
  if (Object.keys(candidate.content).length === 0) {
    throw new Error('candidate content must not be empty');
  }
  validateSha256(candidate.candidateHash, 'candidateHash');
  const { candidateHash, ...withoutHash } = candidate;
  if (candidateHash !== stableSha256(withoutHash)) {
    throw new Error('candidateHash does not match candidate content');
  }
  return deepFreeze(candidate);
}

function normalizeWorkspace(value) {
  assertPlain(value, 'workspace');
  rejectUnknown(value, WORKSPACE_FIELDS, 'workspace');
  requireFields(value, WORKSPACE_FIELDS, 'workspace');
  const workspace = {};
  for (const field of WORKSPACE_FIELDS) {
    if (typeof value[field] !== 'string' || !path.isAbsolute(value[field])) {
      throw new TypeError(`workspace ${field} must be an absolute path`);
    }
    if (value[field].toLowerCase().includes('shared-artifacts')) {
      throw new Error(`workspace ${field} must not reference shared-artifacts`);
    }
    workspace[field] = path.resolve(value[field]);
  }
  for (const field of [
    'planFile',
    'evidenceFile',
    'debugStateFile',
    'candidatesRoot',
    'reviewsRoot',
    'deliverablesRoot',
  ]) {
    assertInside(workspace.taskRoot, workspace[field], `workspace ${field}`);
  }
  return Object.freeze(workspace);
}

async function verifyWorkspaceBoundary(workspace) {
  for (const [filePath, label] of [
    [workspace.taskRoot, 'task root'],
    [workspace.reviewsRoot, 'reviews root'],
  ]) {
    const info = await fs.lstat(filePath);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error(`${label} must be a regular directory without a symbolic link`);
    }
    if (await fs.realpath(filePath) !== path.resolve(filePath)) {
      throw new Error(`${label} must not contain a symbolic link`);
    }
  }
  assertInside(
    await fs.realpath(workspace.taskRoot),
    await fs.realpath(workspace.reviewsRoot),
    'reviews root',
  );
}

function validateReviewRecord(value, expectedHash) {
  assertPlain(value, 'review record');
  rejectUnknown(value, REVIEW_RECORD_FIELDS, 'review record');
  requireFields(value, REQUIRED_REVIEW_RECORD_FIELDS, 'review record');
  if (value.schemaVersion !== 1) throw new Error('review record schemaVersion must be 1');
  if (value.review?.reviewHash !== expectedHash) {
    throw new Error('review record hash does not match filename');
  }
  assertPlain(value.reviewTrustedOptions, 'review trusted options');
  assertPlain(value.diagnostic, 'review diagnostic');
  normalizeRuntimeDeliveryContext(value.deliveryContext);
  validateSha256(
    value.executionContextCommitment,
    'executionContextCommitment',
  );
  validateSha256(
    value.deliveryContextCommitment,
    'deliveryContextCommitment',
  );
  if (
    value.policyContextHash !== null
    && (
      typeof value.policyContextHash !== 'string'
      || !SHA256.test(value.policyContextHash)
    )
  ) {
    throw new Error('review record policyContextHash is invalid');
  }
}

async function writeImmutableJson(filePath, value) {
  if (
    typeof filePath !== 'string'
    || !path.isAbsolute(filePath)
    || filePath.toLowerCase().includes('shared-artifacts')
  ) {
    throw new Error('immutable JSON target is outside the organization boundary');
  }
  const parent = path.dirname(filePath);
  const parentInfo = await fs.lstat(parent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) {
    throw new Error(
      'immutable JSON parent must be a regular directory without a symbolic link',
    );
  }
  if (await fs.realpath(parent) !== path.resolve(parent)) {
    throw new Error('immutable JSON parent contains a symbolic link');
  }
  return withProcessAndFileLock(immutableLocks, filePath, async () => {
    const existing = await lstatOrNull(filePath);
    if (existing !== null) {
      const stored = await readRegularJson(filePath, 'immutable JSON file');
      if (stableStringify(stored) !== stableStringify(value)) {
        throw new Error('immutable JSON file conflicts with stored content');
      }
      return;
    }
    await writeJsonAtomic(filePath, value);
    const stored = await readRegularJson(filePath, 'immutable JSON file');
    if (stableStringify(stored) !== stableStringify(value)) {
      throw new Error('immutable JSON verification failed');
    }
  });
}

async function revalidateWorkspace({ projectRoot, identity, workspace }) {
  const observed = await createBrandProjectWorkspace({
    projectRoot,
    ...identity,
  });
  if (stableStringify(observed) !== stableStringify(workspace)) {
    throw new Error('project workspace boundary changed during callback execution');
  }
}

async function readRegularJson(
  filePath,
  label,
  maximumBytes = MAX_JSON_FILE_BYTES,
) {
  const initial = await fs.lstat(filePath);
  if (!initial.isFile() || initial.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file without a symbolic link`);
  }
  if (initial.size > maximumBytes) {
    throw new Error(`${label} exceeds the JSON byte budget`);
  }
  const canonical = await fs.realpath(filePath);
  if (canonical !== path.resolve(filePath)) {
    throw new Error(`${label} must not contain a symbolic link`);
  }
  let handle;
  let bytes;
  try {
    handle = await fs.open(filePath, 'r');
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > maximumBytes) {
      throw new Error(`${label} exceeds the JSON byte budget`);
    }
    bytes = await handle.readFile();
    if (bytes.length > maximumBytes) {
      throw new Error(`${label} exceeds the JSON byte budget`);
    }
    const after = await handle.stat();
    if (
      after.size !== opened.size
      || after.mtimeMs !== opened.mtimeMs
      || after.size !== bytes.length
    ) throw new Error(`${label} changed while it was being read`);
  } finally {
    await handle?.close().catch(() => {});
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} JSON is invalid: ${error.message}`, {
      cause: error,
    });
  }
  return snapshotStableJson(value, label);
}

async function assertRegularFile(filePath, label) {
  const info = await fs.lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file without a symbolic link`);
  }
}

async function lstatOrNull(filePath) {
  return fs.lstat(filePath).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
}

function boundedChild(base, fileName, label) {
  const candidate = path.join(base, fileName);
  assertInside(base, candidate, label);
  return candidate;
}

function assertInside(base, candidate, label) {
  const relative = path.relative(path.resolve(base), path.resolve(candidate));
  if (
    relative === ''
    || relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) throw new Error(`${label} escapes its directory boundary`);
}

async function withTaskExecutionLease({
  workspace,
  identity,
  skillId,
  policyContextHash,
}, operation) {
  const leasePath = boundedChild(
    workspace.taskRoot,
    'runtime-execution.lease.json',
    'task execution lease',
  );
  const token = randomUUID();
  const deadline = Date.now() + 30_000;
  let acquired = false;
  while (!acquired) {
    let handle = null;
    try {
      handle = await fs.open(leasePath, 'wx', 0o600);
      const timestamp = new Date().toISOString();
      const record = canonicalJsonValue({
        schemaVersion: 1,
        token,
        pid: process.pid,
        createdAt: timestamp,
        heartbeatAt: timestamp,
        taskIdentity: identity,
        skillId,
        policyContextHash,
      });
      const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = null;
      acquired = true;
    } catch (error) {
      if (handle !== null) {
        await handle.close().catch(() => {});
        handle = null;
      }
      if (error?.code !== 'EEXIST') throw error;
      if (await recoverStaleOwnedRecord(leasePath, {
        label: 'task execution lease',
        staleMs: TASK_LEASE_STALE_MS,
      })) continue;
      if (Date.now() >= deadline) {
        throw new Error('timed out waiting for task execution lease');
      }
      await delay(25);
    }
  }
  const acquiredRecord = await readTaskLeaseRecord(leasePath);
  if (
    acquiredRecord.token !== token
    || acquiredRecord.pid !== process.pid
    || stableStringify(acquiredRecord.taskIdentity) !== stableStringify(identity)
    || acquiredRecord.skillId !== skillId
    || acquiredRecord.policyContextHash !== policyContextHash
  ) {
    await releaseOwnedLock(leasePath, token);
    throw new Error('task execution lease binding changed during acquisition');
  }
  let heartbeatError = null;
  let heartbeatChain = Promise.resolve();
  const heartbeat = setInterval(() => {
    heartbeatChain = heartbeatChain
      .then(() => refreshTaskExecutionLease(leasePath, token))
      .catch((error) => {
        heartbeatError ??= error;
      });
  }, TASK_LEASE_HEARTBEAT_MS);
  heartbeat.unref?.();
  try {
    const result = await operation();
    await heartbeatChain;
    if (heartbeatError !== null) throw heartbeatError;
    return result;
  } finally {
    clearInterval(heartbeat);
    await heartbeatChain.catch(() => {});
    await releaseOwnedLock(leasePath, token);
  }
}

async function refreshTaskExecutionLease(leasePath, token) {
  const current = await readTaskLeaseRecord(leasePath);
  if (current.token !== token) {
    throw new Error('task execution lease ownership was lost');
  }
  const next = canonicalJsonValue({
    ...current,
    heartbeatAt: new Date().toISOString(),
  });
  await writeJsonAtomic(leasePath, next);
  const observed = await readTaskLeaseRecord(leasePath);
  if (observed.token !== token) {
    throw new Error('task execution lease changed during heartbeat');
  }
}

async function readTaskLeaseRecord(filePath) {
  const label = 'task execution lease';
  const value = await readRegularJson(filePath, label, 64 * 1024);
  await assertCanonicalJsonFile(filePath, value, label, 64 * 1024);
  assertPlain(value, label);
  rejectUnknown(value, TASK_LEASE_FIELDS, label);
  requireFields(value, TASK_LEASE_FIELDS, label);
  if (
    value.schemaVersion !== 1
    || !Number.isSafeInteger(value.pid)
    || value.pid <= 0
    || typeof value.token !== 'string'
    || value.token.length === 0
    || !Number.isFinite(Date.parse(value.createdAt))
    || !Number.isFinite(Date.parse(value.heartbeatAt))
  ) throw new Error('task execution lease record is invalid');
  validateTaskIdentity(value.taskIdentity);
  safeId(value.skillId, 'task execution lease skillId');
  if (
    value.policyContextHash !== null
    && (
      typeof value.policyContextHash !== 'string'
      || !SHA256.test(value.policyContextHash)
    )
  ) throw new Error('task execution lease policyContextHash is invalid');
  return value;
}

async function assertCanonicalJsonFile(filePath, value, label, maximumBytes) {
  const bytes = await fs.readFile(filePath);
  if (bytes.length > maximumBytes) {
    throw new Error(`${label} exceeds the JSON byte budget`);
  }
  const canonical = canonicalJsonValue(value);
  const expected = Buffer.from(
    `${JSON.stringify(canonical, null, 2)}\n`,
    'utf8',
  );
  if (!bytes.equals(expected)) throw new Error(`${label} bytes are not canonical`);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withLock(map, key, operation) {
  const normalizedKey = path.resolve(key);
  const previous = map.get(normalizedKey) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  map.set(normalizedKey, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (map.get(normalizedKey) === current) map.delete(normalizedKey);
  }
}

async function withProcessAndFileLock(map, key, operation) {
  return withLock(map, key, () => withFilesystemLock(key, operation));
}

async function withFilesystemLock(targetPath, operation) {
  const lockPath = `${path.resolve(targetPath)}.lock`;
  const parent = path.dirname(lockPath);
  const canonicalParent = await fs.realpath(parent);
  if (canonicalParent !== path.resolve(parent)) {
    throw new Error('lock parent contains a symbolic link or junction');
  }
  const token = randomUUID();
  const deadline = Date.now() + 10_000;
  let handle = null;
  while (handle === null) {
    let created = false;
    try {
      handle = await fs.open(lockPath, 'wx', 0o600);
      created = true;
      await handle.writeFile(JSON.stringify({
        token,
        pid: process.pid,
        createdAt: new Date().toISOString(),
      }));
      await handle.sync();
      const observed = await fs.lstat(lockPath);
      if (!observed.isFile() || observed.isSymbolicLink()) {
        throw new Error('lock must be a regular file');
      }
      if (await fs.realpath(lockPath) !== path.resolve(lockPath)) {
        throw new Error('lock path was replaced by a symbolic link');
      }
    } catch (error) {
      if (handle !== null) {
        await handle.close().catch(() => {});
        handle = null;
      }
      if (created) {
        const createdInfo = await lstatOrNull(lockPath);
        if (createdInfo?.isFile() && !createdInfo.isSymbolicLink()) {
          await fs.unlink(lockPath).catch(() => {});
        }
      }
      if (error?.code !== 'EEXIST') throw error;
      if (await recoverStaleLock(lockPath)) continue;
      if (Date.now() >= deadline) {
        throw new Error(`timed out waiting for filesystem lock: ${lockPath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  }
  try {
    return await operation();
  } finally {
    await handle.close().catch(() => {});
    await releaseOwnedLock(lockPath, token);
  }
}

async function recoverStaleLock(lockPath) {
  return recoverStaleOwnedRecord(lockPath, {
    label: 'filesystem lock',
    staleMs: 1_000,
  });
}

async function recoverStaleOwnedRecord(targetPath, { label, staleMs }) {
  const guardPath = `${targetPath}.recovery`;
  const guardToken = randomUUID();
  const guardHandle = await acquireRecoveryGuard({
    guardPath,
    guardToken,
    staleMs,
  });
  if (guardHandle === null) return false;
  try {
    const firstInfo = await lstatOrNull(targetPath);
    if (firstInfo === null) return true;
    assertOwnedRecordFile(firstInfo, label);
    if (await fs.realpath(targetPath) !== path.resolve(targetPath)) {
      throw new Error(`${label} path contains a symbolic link`);
    }
    const firstRecord = await readOwnedRecordForRecovery(targetPath);
    if (!ownedRecordIsRecoverable(firstRecord, firstInfo, staleMs)) {
      return false;
    }
    const firstIdentity = fileIdentity(firstInfo);
    const secondInfo = await lstatOrNull(targetPath);
    if (secondInfo === null) return true;
    assertOwnedRecordFile(secondInfo, label);
    const secondRecord = await readOwnedRecordForRecovery(targetPath);
    if (
      !sameFileIdentity(firstIdentity, fileIdentity(secondInfo))
      || firstRecord?.token !== secondRecord?.token
      || !ownedRecordIsRecoverable(secondRecord, secondInfo, staleMs)
    ) return false;
    const quarantine = `${targetPath}.stale-${randomUUID()}`;
    try {
      await fs.rename(targetPath, quarantine);
    } catch (error) {
      if (['ENOENT', 'EACCES', 'EPERM'].includes(error?.code)) return false;
      throw error;
    }
    const movedInfo = await fs.lstat(quarantine);
    const movedRecord = await readOwnedRecordForRecovery(quarantine);
    if (
      !sameFileIdentity(firstIdentity, fileIdentity(movedInfo))
      || movedRecord?.token !== firstRecord?.token
    ) {
      throw new Error(`${label} identity changed during stale recovery`);
    }
    await fs.unlink(quarantine);
    return true;
  } finally {
    await guardHandle.close().catch(() => {});
    await releaseOwnedLock(guardPath, guardToken).catch(async () => {
      const record = await readOwnedRecordForRecovery(guardPath);
      if (record?.token === guardToken) await fs.unlink(guardPath).catch(() => {});
    });
  }
}

async function acquireRecoveryGuard({ guardPath, guardToken, staleMs }) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let handle = null;
    let created = false;
    try {
      handle = await fs.open(guardPath, 'wx', 0o600);
      created = true;
      await handle.writeFile(JSON.stringify({
        token: guardToken,
        pid: process.pid,
        createdAt: new Date().toISOString(),
      }));
      await handle.sync();
      const info = await fs.lstat(guardPath);
      assertOwnedRecordFile(info, 'recovery guard');
      if (await fs.realpath(guardPath) !== path.resolve(guardPath)) {
        throw new Error('recovery guard path contains a symbolic link');
      }
      return handle;
    } catch (error) {
      if (handle !== null) await handle.close().catch(() => {});
      if (created) await releaseOwnedLock(guardPath, guardToken).catch(() => {});
      if (error?.code !== 'EEXIST') throw error;
      const recovered = await recoverRecoveryGuardWithoutAnotherGuard({
        guardPath,
        staleMs,
      });
      if (!recovered) return null;
      await delay(Math.min(2 ** attempt, 16));
    }
  }
  return null;
}

async function recoverRecoveryGuardWithoutAnotherGuard({
  guardPath,
  staleMs,
}) {
  const firstInfo = await lstatOrNull(guardPath);
  if (firstInfo === null) return true;
  assertOwnedRecordFile(firstInfo, 'recovery guard');
  let canonicalGuardPath;
  try {
    canonicalGuardPath = await fs.realpath(guardPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return true;
    throw error;
  }
  if (canonicalGuardPath !== path.resolve(guardPath)) {
    throw new Error('recovery guard path contains a symbolic link');
  }
  const firstRecord = await readOwnedRecordForRecovery(guardPath);
  if (!ownedRecordIsRecoverable(firstRecord, firstInfo, staleMs)) return false;
  const firstIdentity = fileIdentity(firstInfo);
  const secondInfo = await lstatOrNull(guardPath);
  if (secondInfo === null) return true;
  assertOwnedRecordFile(secondInfo, 'recovery guard');
  const secondRecord = await readOwnedRecordForRecovery(guardPath);
  if (
    !sameFileIdentity(firstIdentity, fileIdentity(secondInfo))
    || firstRecord?.token !== secondRecord?.token
    || !ownedRecordIsRecoverable(secondRecord, secondInfo, staleMs)
  ) return false;
  const quarantine = `${guardPath}.stale-${randomUUID()}`;
  try {
    await fs.rename(guardPath, quarantine);
  } catch (error) {
    if (['ENOENT', 'EACCES', 'EPERM'].includes(error?.code)) return true;
    throw error;
  }
  const movedInfo = await fs.lstat(quarantine);
  const movedRecord = await readOwnedRecordForRecovery(quarantine);
  if (
    sameFileIdentity(firstIdentity, fileIdentity(movedInfo))
    && movedRecord?.token === firstRecord?.token
    && ownedRecordIsRecoverable(movedRecord, movedInfo, staleMs)
  ) {
    await fs.unlink(quarantine);
    return true;
  }
  await restoreQuarantinedGuard({
    quarantine,
    guardPath,
    movedInfo,
    movedRecord,
  });
  return false;
}

async function restoreQuarantinedGuard({
  quarantine,
  guardPath,
  movedInfo,
  movedRecord,
}) {
  try {
    await fs.link(quarantine, guardPath);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const currentInfo = await fs.lstat(guardPath);
    const currentRecord = await readOwnedRecordForRecovery(guardPath);
    if (
      !sameFileIdentity(fileIdentity(movedInfo), fileIdentity(currentInfo))
      || movedRecord?.token !== currentRecord?.token
    ) {
      throw new Error(
        'recovery guard changed during recovery and could not be restored safely',
      );
    }
  }
  await fs.unlink(quarantine);
}

function assertOwnedRecordFile(info, label) {
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${label} was replaced by a symbolic link or directory`);
  }
}

async function readOwnedRecordForRecovery(filePath) {
  try {
    const info = await fs.lstat(filePath);
    if (info.size > 64 * 1024) return null;
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function ownedRecordIsRecoverable(record, info, staleMs) {
  const now = Date.now();
  const timestampValue = record?.heartbeatAt ?? record?.createdAt;
  const timestamp = typeof timestampValue === 'string'
    ? Date.parse(timestampValue)
    : Number.NaN;
  const futureCorrupt = Number.isFinite(timestamp)
    && timestamp > now + MAX_CLOCK_SKEW_MS;
  const age = Number.isFinite(timestamp) && !futureCorrupt
    ? now - timestamp
    : now - info.mtimeMs;
  const hasOwner = Number.isSafeInteger(record?.pid) && record.pid > 0;
  if (hasOwner && isProcessAlive(record.pid)) return false;
  if (hasOwner) return futureCorrupt || age > staleMs;
  return age > 30_000;
}

function fileIdentity(info) {
  return {
    dev: info.dev,
    ino: info.ino,
    size: info.size,
    mtimeMs: info.mtimeMs,
    birthtimeMs: info.birthtimeMs,
  };
}

function sameFileIdentity(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function releaseOwnedLock(lockPath, token) {
  const info = await lstatOrNull(lockPath);
  if (info === null) return;
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error('owned filesystem lock was replaced');
  }
  let record;
  try {
    record = JSON.parse(await fs.readFile(lockPath, 'utf8'));
  } catch {
    return;
  }
  if (record?.token === token) await fs.unlink(lockPath);
}

function assertStateIdentity(state, identity) {
  assertPlain(state, 'debug state');
  if (stableStringify(state.taskIdentity) !== stableStringify(identity)) {
    throw new Error('debug state task identity does not match request');
  }
}

function assertDebugBindings(state, plan, evidenceBundle) {
  if (
    state.planHash !== plan.planHash
    || state.evidenceHash !== evidenceBundle.evidenceHash
    || state.skillId !== plan.skillId
  ) throw new Error('restored debug state bindings do not match plan/evidence');
}

function validateSha256(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new TypeError(`${label} must be lowercase SHA-256`);
  }
  return value;
}

function nowIso(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error('trusted now returned an invalid date');
  return date.toISOString();
}

function normalizeOptionalText(value, label) {
  if (value === '') return value;
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || value.length > 4000
  ) throw new TypeError(`${label} must be normalized text`);
  return value;
}

function normalizeTextArray(value, label) {
  if (!Array.isArray(value) || value.length > 100) {
    throw new TypeError(`${label} must be an array`);
  }
  return value.map((item, index) => {
    if (
      typeof item !== 'string'
      || item.trim() !== item
      || item.length === 0
      || item.length > 2000
    ) throw new TypeError(`${label}[${index}] must be normalized text`);
    return item;
  });
}

function snapshotStableJson(value, label) {
  return snapshotStableJsonNode(value, label, new Set(), {
    nodes: 0,
    utf8Bytes: 0,
  }, 0);
}

function snapshotStableJsonNode(value, label, ancestors, budget, depth) {
  if (depth > MAX_SNAPSHOT_DEPTH) {
    throw new TypeError(`${label} exceeds the stable JSON depth budget`);
  }
  budget.nodes += 1;
  if (budget.nodes > MAX_SNAPSHOT_NODES) {
    throw new TypeError(`${label} exceeds the stable JSON node budget`);
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    addSnapshotBytes(budget, value === null
      ? 4
      : Buffer.byteLength(JSON.stringify(value), 'utf8'), label);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${label} is not stable JSON`);
    addSnapshotBytes(budget, Buffer.byteLength(String(value), 'utf8'), label);
    return value;
  }
  if (typeof value !== 'object') throw new TypeError(`${label} is not stable JSON`);
  if (utilTypes.isProxy(value)) throw new TypeError(`${label} must not be a Proxy`);
  if (ancestors.has(value)) throw new TypeError(`${label} contains a cycle`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_SNAPSHOT_ARRAY_LENGTH) {
        throw new TypeError(`${label} exceeds the stable JSON array budget`);
      }
      addSnapshotBytes(budget, 2 + Math.max(0, value.length - 1), label);
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const allowed = new Set([
        'length',
        ...Array.from({ length: value.length }, (_, index) => String(index)),
      ]);
      if (
        Object.getOwnPropertySymbols(value).length > 0
        || Object.getOwnPropertyNames(value).some((key) => !allowed.has(key))
      ) throw new TypeError(`${label} array contains extra properties`);
      const result = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (
          descriptor === undefined
          || descriptor.get !== undefined
          || descriptor.set !== undefined
        ) throw new TypeError(`${label} contains an accessor or sparse array`);
        result.push(snapshotStableJsonNode(
          descriptor.value,
          `${label}[${index}]`,
          ancestors,
          budget,
          depth + 1,
        ));
      }
      return result;
    }
    assertPlain(value, label);
    addSnapshotBytes(budget, 2, label);
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError(`${label} contains symbol keys`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result = {};
    for (const key of Object.keys(value)) {
      addSnapshotBytes(
        budget,
        Buffer.byteLength(JSON.stringify(key), 'utf8') + 2,
        label,
      );
      const descriptor = descriptors[key];
      if (
        descriptor === undefined
        || descriptor.get !== undefined
        || descriptor.set !== undefined
        || descriptor.enumerable !== true
      ) throw new TypeError(`${label}.${key} must be an enumerable data field`);
      result[key] = snapshotStableJsonNode(
        descriptor.value,
        `${label}.${key}`,
        ancestors,
        budget,
        depth + 1,
      );
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function addSnapshotBytes(budget, bytes, label) {
  budget.utf8Bytes += bytes;
  if (budget.utf8Bytes > MAX_SNAPSHOT_UTF8_BYTES) {
    throw new TypeError(`${label} exceeds the stable JSON UTF-8 byte budget`);
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
