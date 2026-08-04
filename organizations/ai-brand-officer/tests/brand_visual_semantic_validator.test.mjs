import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  stableSha256,
} from '../scripts/brand_contracts.mjs';
import {
  buildBrandTaskPlan,
} from '../scripts/brand_task_planner.mjs';
import {
  validateBrandVisualCandidate,
} from '../scripts/brand_visual_semantic_validator.mjs';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const IDENTITY = Object.freeze({
  enterpriseId: 'enterprise-001',
  businessProjectId: 'project-001',
  taskId: 'visual-task-001',
});
const BRAND_ID = 'brand-001';
const COMMANDER_TASK_ID = 'commander-task-001';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function makePlan({
  selectedModuleIds = ['poster-art-direction', 'ai-visual-generation'],
  upstreamArtifacts = [],
  goal = '制作单张临时活动海报并探索视觉主体',
} = {}) {
  return buildBrandTaskPlan({
    ...IDENTITY,
    skillId: 'brand-visual',
    goal,
    requestedModuleIds: selectedModuleIds,
    availableInputs: {},
    constraints: {},
    upstreamArtifacts,
  });
}

function makeCandidate({
  plan = makePlan(),
  contentOverrides = {},
} = {}) {
  const content = {
    schemaVersion: 1,
    brandId: BRAND_ID,
    selectedModuleIds: [...plan.selectedModuleIds],
    directionCandidates: [
      {
        directionId: 'direction-01',
        imageSha256: HASH_A,
      },
      {
        directionId: 'direction-02',
        imageSha256: HASH_B,
      },
      {
        directionId: 'direction-03',
        imageSha256: HASH_C,
      },
    ],
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
      enterpriseId: IDENTITY.enterpriseId,
      businessProjectId: IDENTITY.businessProjectId,
      brandId: BRAND_ID,
      artifactId: 'aesthetic-profile',
      version: 1,
      sha256: HASH_A,
      importSnapshotRef: null,
    },
    publicCapabilityHandoffs: [],
    ...contentOverrides,
  };
  const withoutHash = {
    candidateId: 'visual-candidate-001',
    ...IDENTITY,
    skillId: 'brand-visual',
    content,
  };
  return {
    ...withoutHash,
    candidateHash: stableSha256(withoutHash),
  };
}

async function makeTrustedCase(t, {
  publicSkillIds = ['public.promotional-poster'],
  registryMaturity = 'operational',
  allowedOrganizations = ['ai-brand-officer'],
} = {}) {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'brand-visual-validator-'),
  );
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));
  const registry = {
    schemaVersion: 1,
    publicSkills: [{
      id: 'public.promotional-poster',
      displayName: '普通宣传海报',
      capabilityId: 'promotional-poster',
      maturity: registryMaturity,
      allowedOrganizations,
      defaultPrimaryOrganization: 'ai-brand-officer',
    }],
  };
  const registryBytes = Buffer.from(`${JSON.stringify(registry, null, 2)}\n`);
  const registryPath = path.join(projectRoot, 'public-skills', 'registry.json');
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(registryPath, registryBytes);

  const project = {
    schemaVersion: 1,
    enterpriseId: IDENTITY.enterpriseId,
    businessProjectId: IDENTITY.businessProjectId,
    primaryOrganizationId: 'ai-brand-officer',
    publicSkillIds,
    status: 'active',
    contextVersion: 1,
    commanderTaskId: COMMANDER_TASK_ID,
  };
  const projectBytes = Buffer.from(`${JSON.stringify(project, null, 2)}\n`);
  const projectPath = path.join(
    projectRoot,
    'business-projects',
    IDENTITY.enterpriseId,
    IDENTITY.businessProjectId,
    'project.json',
  );
  await fs.mkdir(path.dirname(projectPath), { recursive: true });
  await fs.writeFile(projectPath, projectBytes);
  return {
    projectRoot,
    registrySha256: sha256(registryBytes),
    projectSha256: sha256(projectBytes),
    visualPolicyContext: {
      schemaVersion: 1,
      projectContextVersion: 1,
      commanderTaskId: COMMANDER_TASK_ID,
    },
  };
}

function makePosterHandoff(trusted, overrides = {}) {
  return {
    registryRef: {
      path: 'public-skills/registry.json',
      versionOrHash: `sha256:${trusted.registrySha256}`,
      sha256: trusted.registrySha256,
      readAt: '2026-07-30T00:00:00.000Z',
    },
    publicSkillId: 'public.promotional-poster',
    capabilityId: 'promotional-poster',
    maturity: 'operational',
    allowedOrganizations: ['ai-brand-officer'],
    controllerTaskAuthorizationRef: {
      enterpriseId: IDENTITY.enterpriseId,
      businessProjectId: IDENTITY.businessProjectId,
      taskId: IDENTITY.taskId,
      contextVersion: 1,
      projectFileSha256: trusted.projectSha256,
      commanderTaskId: COMMANDER_TASK_ID,
    },
    authorized: true,
    decision: 'allow-formal-execution',
    ...overrides,
  };
}

test('candidate schema and semantic validator require three distinct visual assets and all three pairs', async (t) => {
  const trusted = await makeTrustedCase(t);
  const plan = makePlan();
  await assert.doesNotReject(() => validateBrandVisualCandidate(
    makeCandidate({ plan }),
    {
      plan,
      projectRoot: trusted.projectRoot,
      brandId: BRAND_ID,
      visualPolicyContext: trusted.visualPolicyContext,
    },
  ));

  const duplicate = makeCandidate({
    plan,
    contentOverrides: {
      directionCandidates: [
        { directionId: 'direction-01', imageSha256: HASH_A },
        { directionId: 'direction-02', imageSha256: HASH_A },
        { directionId: 'direction-03', imageSha256: HASH_C },
      ],
    },
  });
  await assert.rejects(
    validateBrandVisualCandidate(duplicate, {
      plan,
      projectRoot: trusted.projectRoot,
      brandId: BRAND_ID,
      visualPolicyContext: trusted.visualPolicyContext,
    }),
    /distinct|unique|重复/u,
  );

  const missingPair = makeCandidate({
    plan,
    contentOverrides: {
      pairwiseDifferenceEvidence: [
        {
          directionIds: ['direction-01', 'direction-02'],
          dimensions: ['composition', 'lighting'],
        },
        {
          directionIds: ['direction-01', 'direction-03'],
          dimensions: ['color', 'typography'],
        },
      ],
    },
  });
  await assert.rejects(
    validateBrandVisualCandidate(missingPair, {
      plan,
      projectRoot: trusted.projectRoot,
      brandId: BRAND_ID,
      visualPolicyContext: trusted.visualPolicyContext,
    }),
    /three pairs|pairwise|三对/u,
  );
});

test('public capability handoff requires registry maturity, organization permission, and controller task authorization', async (t) => {
  const trusted = await makeTrustedCase(t);
  const plan = makePlan();
  const valid = makeCandidate({
    plan,
    contentOverrides: {
      publicCapabilityHandoffs: [makePosterHandoff(trusted)],
    },
  });
  await assert.doesNotReject(() => validateBrandVisualCandidate(valid, {
    plan,
    projectRoot: trusted.projectRoot,
    brandId: BRAND_ID,
    visualPolicyContext: trusted.visualPolicyContext,
  }));

  const unauthorized = await makeTrustedCase(t, { publicSkillIds: [] });
  const forged = makeCandidate({
    plan,
    contentOverrides: {
      publicCapabilityHandoffs: [makePosterHandoff(unauthorized)],
    },
  });
  await assert.rejects(
    validateBrandVisualCandidate(forged, {
      plan,
      projectRoot: unauthorized.projectRoot,
      brandId: BRAND_ID,
      visualPolicyContext: unauthorized.visualPolicyContext,
    }),
    /publicSkillIds|controller|authorization|授权/u,
  );
});

test('cross-project aesthetic profile is rejected without an exact trusted import snapshot and accepted with one', async (t) => {
  const trusted = await makeTrustedCase(t);
  const importArtifact = {
    artifactId: 'imported-aesthetic-profile',
    version: 2,
    sha256: HASH_B,
    sourceOrganizationId: 'ai-brand-officer',
  };
  const noImportPlan = makePlan();
  const stolen = makeCandidate({
    plan: noImportPlan,
    contentOverrides: {
      aestheticProfileRef: {
        enterpriseId: 'other-enterprise',
        businessProjectId: 'other-project',
        brandId: 'other-brand',
        artifactId: importArtifact.artifactId,
        version: importArtifact.version,
        sha256: importArtifact.sha256,
        importSnapshotRef: null,
      },
    },
  });
  await assert.rejects(
    validateBrandVisualCandidate(stolen, {
      plan: noImportPlan,
      projectRoot: trusted.projectRoot,
      brandId: BRAND_ID,
      visualPolicyContext: trusted.visualPolicyContext,
    }),
    /cross-project|snapshot|跨项目/u,
  );

  const importedPlan = makePlan({ upstreamArtifacts: [importArtifact] });
  const imported = makeCandidate({
    plan: importedPlan,
    contentOverrides: {
      aestheticProfileRef: {
        enterpriseId: 'other-enterprise',
        businessProjectId: 'other-project',
        brandId: 'other-brand',
        artifactId: importArtifact.artifactId,
        version: importArtifact.version,
        sha256: importArtifact.sha256,
        importSnapshotRef: { ...importArtifact },
      },
    },
  });
  await assert.doesNotReject(() => validateBrandVisualCandidate(imported, {
    plan: importedPlan,
    projectRoot: trusted.projectRoot,
    brandId: BRAND_ID,
    visualPolicyContext: trusted.visualPolicyContext,
  }));
});

test('a first project may use a real null aesthetic profile without weakening the exact-three gate', async (t) => {
  const trusted = await makeTrustedCase(t);
  const plan = makePlan();
  const noProfile = makeCandidate({
    plan,
    contentOverrides: {
      aestheticProfileRef: null,
    },
  });
  await assert.doesNotReject(() => validateBrandVisualCandidate(noProfile, {
    plan,
    projectRoot: trusted.projectRoot,
    brandId: BRAND_ID,
    visualPolicyContext: trusted.visualPolicyContext,
  }));

  const fakeEmptyProfile = makeCandidate({
    plan,
    contentOverrides: {
      aestheticProfileRef: {},
    },
  });
  await assert.rejects(
    validateBrandVisualCandidate(fakeEmptyProfile, {
      plan,
      projectRoot: trusted.projectRoot,
      brandId: BRAND_ID,
      visualPolicyContext: trusted.visualPolicyContext,
    }),
    /aestheticProfileRef|missing field|伪空/u,
  );

  const oneDirection = makeCandidate({
    plan,
    contentOverrides: {
      aestheticProfileRef: null,
      directionCandidates: [{
        directionId: 'direction-01',
        imageSha256: HASH_A,
      }],
    },
  });
  await assert.rejects(
    validateBrandVisualCandidate(oneDirection, {
      plan,
      projectRoot: trusted.projectRoot,
      brandId: BRAND_ID,
      visualPolicyContext: trusted.visualPolicyContext,
    }),
    /exactly three|三个/u,
  );

  const schema = JSON.parse(await fs.readFile(
    new URL('../contracts/brand-visual-candidate.schema.json', import.meta.url),
    'utf8',
  ));
  assert.ok(
    schema.properties.content.properties.aestheticProfileRef.oneOf.some(
      (branch) => branch.type === 'null',
    ),
  );
});

test('long-term visual modules require an exact brand-positioning upstream artifact while temporary exploration does not', () => {
  const positioningArtifact = {
    artifactId: 'brand-positioning-core',
    version: 3,
    sha256: HASH_A,
    sourceOrganizationId: 'ai-brand-officer',
  };
  assert.throws(
    () => makePlan({
      selectedModuleIds: ['visual-identity-system'],
      goal: '完成品牌 Logo 与 VI 定稿',
    }),
    /brand-positioning|定位/u,
  );
  assert.doesNotThrow(() => makePlan({
    selectedModuleIds: ['visual-identity-system'],
    upstreamArtifacts: [positioningArtifact],
    goal: '完成品牌 Logo 与 VI 定稿',
  }));
  assert.throws(
    () => makePlan({
      selectedModuleIds: ['product-packaging'],
      upstreamArtifacts: [{
        ...positioningArtifact,
        artifactId: 'generic-brief',
      }],
      goal: '完成产品包装定稿',
    }),
    /brand-positioning|定位/u,
  );
  assert.doesNotThrow(() => makePlan());
});

test('candidate contract is strict and rejects unknown self-reported trust fields', async (t) => {
  const trusted = await makeTrustedCase(t);
  const plan = makePlan();
  const candidate = makeCandidate({
    plan,
    contentOverrides: {
      registryAuthorized: true,
    },
  });
  await assert.rejects(
    validateBrandVisualCandidate(candidate, {
      plan,
      projectRoot: trusted.projectRoot,
      brandId: BRAND_ID,
      visualPolicyContext: trusted.visualPolicyContext,
    }),
    /unknown|registryAuthorized/u,
  );

  const schema = JSON.parse(await fs.readFile(
    new URL('../contracts/brand-visual-candidate.schema.json', import.meta.url),
    'utf8',
  ));
  assert.equal(schema.additionalProperties, false);
  assert.equal(
    schema.properties.content.properties.directionCandidates.minItems,
    3,
  );
  assert.equal(
    schema.properties.content.properties.directionCandidates.maxItems,
    3,
  );
});

test('trusted registry bytes reject BOM, invalid UTF-8, and duplicate JSON keys', async (t) => {
  const cases = [
    {
      label: 'BOM',
      bytes: Buffer.from('\ufeff{"schemaVersion":1,"publicSkills":[]}'),
      pattern: /BOM/u,
    },
    {
      label: 'invalid UTF-8',
      bytes: Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d]),
      pattern: /UTF-8/u,
    },
    {
      label: 'duplicate key',
      bytes: Buffer.from(
        '{"schemaVersion":1,"schemaVersion":1,"publicSkills":[]}',
      ),
      pattern: /duplicate JSON key/u,
    },
  ];
  for (const item of cases) {
    await t.test(item.label, async (t2) => {
      const trusted = await makeTrustedCase(t2);
      await fs.writeFile(
        path.join(trusted.projectRoot, 'public-skills', 'registry.json'),
        item.bytes,
      );
      const plan = makePlan();
      await assert.rejects(
        validateBrandVisualCandidate(makeCandidate({ plan }), {
          plan,
          projectRoot: trusted.projectRoot,
          brandId: BRAND_ID,
          visualPolicyContext: trusted.visualPolicyContext,
        }),
        item.pattern,
      );
    });
  }
});
