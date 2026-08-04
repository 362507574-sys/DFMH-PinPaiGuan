import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  BRAND_SKILL_MODULES,
  stableSha256,
  stableStringify,
} from '../scripts/brand_contracts.mjs';
import {
  buildBrandTaskPlan,
  validateBrandTaskPlan,
} from '../scripts/brand_task_planner.mjs';

const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PLAN_SCHEMA_FILE = path.resolve(
  TEST_ROOT,
  '..',
  'contracts',
  'brand-task-plan.schema.json',
);
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const POSITIONING_ARTIFACT = Object.freeze({
  artifactId: 'brand-positioning-core',
  version: 1,
  sha256: SHA_A,
  sourceOrganizationId: 'ai-brand-officer',
});
const VISUAL_ARTIFACT = Object.freeze({
  artifactId: 'brand-visual-system',
  version: 1,
  sha256: SHA_B,
  sourceOrganizationId: 'ai-brand-officer',
});
const ROOT_FIELDS = Object.freeze([
  'schemaVersion',
  'taskId',
  'enterpriseId',
  'businessProjectId',
  'skillId',
  'goal',
  'selectedModuleIds',
  'skippedModuleIds',
  'steps',
  'requiredEvidence',
  'upstreamArtifacts',
  'acceptanceCriteria',
  'stopConditions',
  'initialState',
  'routingReason',
  'planHash',
]);

function request(overrides = {}) {
  return {
    taskId: 'brand-task-001',
    enterpriseId: 'enterprise-001',
    businessProjectId: 'brand-project-001',
    skillId: 'brand-positioning',
    goal: '明确目标用户与差异化价值',
    requestedModuleIds: [],
    availableInputs: {
      interviewCount: 6,
      sources: ['founder', 'customers'],
    },
    upstreamArtifacts: [],
    constraints: {
      language: 'zh-CN',
      prohibitedClaims: ['行业第一'],
    },
    ...overrides,
  };
}

function assertDeepFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function schemaAccepts(rootSchema, value) {
  return validateSchemaFragment(rootSchema, rootSchema, value).length === 0;
}

function validateSchemaFragment(rootSchema, schema, value, location = '$') {
  if (schema === true) return [];
  if (schema === false) return [`${location} is forbidden`];
  const errors = [];

  if (schema.$ref) {
    errors.push(...validateSchemaFragment(
      rootSchema,
      resolveJsonPointer(rootSchema, schema.$ref),
      value,
      location,
    ));
  }
  if (schema.allOf) {
    for (const part of schema.allOf) {
      errors.push(...validateSchemaFragment(rootSchema, part, value, location));
    }
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter(
      (part) => validateSchemaFragment(rootSchema, part, value, location).length === 0,
    ).length;
    if (matches !== 1) errors.push(`${location} matched ${matches} oneOf branches`);
  }
  if (
    schema.not
    && validateSchemaFragment(rootSchema, schema.not, value, location).length === 0
  ) {
    errors.push(`${location} matched a forbidden schema`);
  }
  if (schema.if) {
    const conditionMatches =
      validateSchemaFragment(rootSchema, schema.if, value, location).length === 0;
    const branch = conditionMatches ? schema.then : schema.else;
    if (branch) {
      errors.push(...validateSchemaFragment(rootSchema, branch, value, location));
    }
  }

  if (schema.type && !matchesType(schema.type, value)) {
    errors.push(`${location} has wrong type`);
    return errors;
  }
  if (Object.hasOwn(schema, 'const') && !isDeepStrictEqual(value, schema.const)) {
    errors.push(`${location} does not equal const`);
  }
  if (
    schema.enum
    && !schema.enum.some((candidate) => isDeepStrictEqual(value, candidate))
  ) {
    errors.push(`${location} is outside enum`);
  }

  if (typeof value === 'string') {
    const codePointLength = Array.from(value).length;
    if (schema.minLength !== undefined && codePointLength < schema.minLength) {
      errors.push(`${location} is shorter than minLength`);
    }
    if (schema.maxLength !== undefined && codePointLength > schema.maxLength) {
      errors.push(`${location} is longer than maxLength`);
    }
    if (schema.pattern && !(new RegExp(schema.pattern, 'u')).test(value)) {
      errors.push(`${location} does not match pattern`);
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${location} is below minimum`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${location} is above maximum`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${location} has too few items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${location} has too many items`);
    }
    if (
      schema.uniqueItems
      && new Set(value.map((item) => stableStringify(item))).size !== value.length
    ) {
      errors.push(`${location} has duplicate items`);
    }
    for (let index = 0; index < (schema.prefixItems?.length ?? 0); index += 1) {
      if (index < value.length) {
        errors.push(...validateSchemaFragment(
          rootSchema,
          schema.prefixItems[index],
          value[index],
          `${location}[${index}]`,
        ));
      }
    }
    const itemStart = schema.prefixItems?.length ?? 0;
    if (schema.items !== undefined) {
      for (let index = itemStart; index < value.length; index += 1) {
        errors.push(...validateSchemaFragment(
          rootSchema,
          schema.items,
          value[index],
          `${location}[${index}]`,
        ));
      }
    }
    if (
      schema.contains
      && !value.some(
        (item, index) => validateSchemaFragment(
          rootSchema,
          schema.contains,
          item,
          `${location}[${index}]`,
        ).length === 0,
      )
    ) {
      errors.push(`${location} does not contain a matching item`);
    }
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) {
        errors.push(`${location} is missing ${required}`);
      }
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) {
        errors.push(...validateSchemaFragment(
          rootSchema,
          child,
          value[key],
          `${location}.${key}`,
        ));
      }
    }
    if (schema.additionalProperties === false) {
      const known = new Set(Object.keys(schema.properties ?? {}));
      const patterns = Object.keys(schema.patternProperties ?? {})
        .map((pattern) => new RegExp(pattern, 'u'));
      for (const key of Object.keys(value)) {
        if (!known.has(key) && !patterns.some((pattern) => pattern.test(key))) {
          errors.push(`${location} has additional property ${key}`);
        }
      }
    }
  }
  return errors;
}

function matchesType(type, value) {
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'null') return value === null;
  return typeof value === type;
}

function resolveJsonPointer(rootSchema, reference) {
  assert.match(reference, /^#\//u);
  return reference.slice(2).split('/').reduce(
    (node, part) => node[part.replaceAll('~1', '/').replaceAll('~0', '~')],
    rootSchema,
  );
}

function rehashPlan(plan) {
  const { planHash: ignored, ...planWithoutHash } = plan;
  plan.planHash = stableSha256(planWithoutHash);
  return plan;
}

test('explicit modules take priority, preserve caller order, deduplicate, and skip the rest', () => {
  const plan = buildBrandTaskPlan(request({
    skillId: 'brand-visual',
    goal: '需要完整视觉体系、门店、海报、包装和生图',
    requestedModuleIds: [
      'product-packaging',
      'visual-identity-system',
      'product-packaging',
    ],
    upstreamArtifacts: [POSITIONING_ARTIFACT],
  }));

  assert.deepEqual(plan.selectedModuleIds, [
    'product-packaging',
    'visual-identity-system',
  ]);
  assert.deepEqual(plan.skippedModuleIds, [
    'store-identity',
    'poster-art-direction',
    'ai-visual-generation',
  ]);
  assert.equal(plan.routingReason, 'explicit-modules');
});

test('positioning goal selects only audience and differentiation modules', () => {
  const plan = buildBrandTaskPlan(request({
    goal: '明确核心用户，并说清我们的差异与为什么选我们',
  }));
  assert.deepEqual(plan.selectedModuleIds, [
    'audience-positioning',
    'differentiation-positioning',
  ]);
  assert.deepEqual(plan.skippedModuleIds, [
    'category-positioning',
    'mindshare-occupation',
  ]);
  assert.equal(plan.routingReason, 'goal-keyword-match');
});

function assertPositioningSupportingRoute(
  goal,
  expectedModuleIds,
  supportingStepIds,
) {
  const expectedSupportingStepIds = Array.isArray(supportingStepIds)
    ? supportingStepIds
    : [supportingStepIds];
  const plan = buildBrandTaskPlan(request({ goal }));
  assert.deepEqual(plan.selectedModuleIds, expectedModuleIds);
  assert.equal(plan.routingReason, 'goal-keyword-match');
  const evidenceText = plan.requiredEvidence
    .map(({ description }) => description)
    .join('\n');
  for (const moduleId of expectedModuleIds) {
    assert.match(evidenceText, new RegExp(moduleId, 'u'));
  }
  for (const supportingStepId of expectedSupportingStepIds) {
    assert.ok(
      plan.requiredEvidence.some(
        ({ requirementId }) => requirementId === `supporting-step-${supportingStepId}`,
      ),
    );
    assert.match(
      plan.acceptanceCriteria.join('\n'),
      new RegExp(`supportingStep ${supportingStepId}`, 'u'),
    );
    assert.match(
      plan.stopConditions.join('\n'),
      new RegExp(`supportingStep ${supportingStepId}`, 'u'),
    );
  }
  assert.match(plan.stopConditions.join('\n'), /三轮.*停止/us);
  assert.match(plan.stopConditions.join('\n'), /业务方向/u);
  return plan;
}

test('brand architecture support route selects category, differentiation, and mindshare only', () => {
  const plan = assertPositioningSupportingRoute(
    '规划母子品牌与品牌架构',
    [
      'category-positioning',
      'differentiation-positioning',
      'mindshare-occupation',
    ],
    'brand-architecture',
  );
  assert.ok(!plan.selectedModuleIds.includes('audience-positioning'));
});

test('brand name support route selects category and mindshare only', () => {
  const plan = assertPositioningSupportingRoute(
    '为现有产品提供品牌名称候选',
    ['category-positioning', 'mindshare-occupation'],
    'brand-name',
  );
  assert.ok(plan.selectedModuleIds.length < 4);
});

test('slogan support route selects mindshare only', () => {
  const plan = assertPositioningSupportingRoute(
    '优化品牌口号',
    ['mindshare-occupation'],
    'slogan',
  );
  assert.ok(plan.selectedModuleIds.length < 4);
});

test('new product extension support route changes audience without forcing mindshare', () => {
  const plan = assertPositioningSupportingRoute(
    '母品牌推出新品延伸，而且目标人群发生变化',
    [
      'category-positioning',
      'audience-positioning',
      'differentiation-positioning',
    ],
    'product-extension',
  );
  assert.ok(!plan.selectedModuleIds.includes('mindshare-occupation'));
});

test('whole legacy brand upgrade support route intentionally selects all four modules', () => {
  assertPositioningSupportingRoute(
    '老品牌整体升级并进行整体重定位',
    BRAND_SKILL_MODULES['brand-positioning'],
    'whole-repositioning',
  );
});

test('new product extension includes mindshare only when the primary mindshare changes', () => {
  assertPositioningSupportingRoute(
    '母品牌推出新品延伸，目标人群不变但要改变主心智',
    BRAND_SKILL_MODULES['brand-positioning'],
    'product-extension',
  );
});

test('brand name support route merges an ordinary audience keyword module', () => {
  assertPositioningSupportingRoute(
    '定义品牌名称候选并明确目标用户',
    [
      'category-positioning',
      'audience-positioning',
      'mindshare-occupation',
    ],
    ['brand-name'],
  );
});

test('product extension and slogan preserve both supporting steps', () => {
  assertPositioningSupportingRoute(
    '新品延伸同时优化品牌口号',
    BRAND_SKILL_MODULES['brand-positioning'],
    ['product-extension', 'slogan'],
  );
});

test('brand architecture and brand name preserve both supporting steps', () => {
  assertPositioningSupportingRoute(
    '规划品牌架构并提供品牌名称候选',
    [
      'category-positioning',
      'differentiation-positioning',
      'mindshare-occupation',
    ],
    ['brand-architecture', 'brand-name'],
  );
});

test('supporting step and selected module order are stable when goal word order reverses', () => {
  const first = buildBrandTaskPlan(request({
    goal: '明确目标用户并提供品牌名称候选',
  }));
  const second = buildBrandTaskPlan(request({
    goal: '提供品牌名称候选并明确目标用户',
  }));
  assert.deepEqual(first.selectedModuleIds, second.selectedModuleIds);
  assert.deepEqual(first.requiredEvidence, second.requiredEvidence);
  assert.deepEqual(first.acceptanceCriteria, second.acceptanceCriteria);
  assert.deepEqual(first.stopConditions, second.stopConditions);
  assert.deepEqual(first.selectedModuleIds, [
    'category-positioning',
    'audience-positioning',
    'mindshare-occupation',
  ]);
});

test('explicit positioning modules reject missing supporting step dependencies', () => {
  assert.throws(
    () => buildBrandTaskPlan(request({
      goal: '提供品牌名称候选',
      requestedModuleIds: ['mindshare-occupation'],
    })),
    /supportingStep dependencies.*category-positioning/u,
  );
});

test('explicit positioning modules keep supporting step checks when dependencies are complete', () => {
  const plan = buildBrandTaskPlan(request({
    goal: '提供品牌名称候选',
    requestedModuleIds: [
      'category-positioning',
      'mindshare-occupation',
    ],
  }));
  assert.ok(
    plan.requiredEvidence.some(
      ({ requirementId }) => requirementId === 'supporting-step-brand-name',
    ),
  );
  assert.match(
    plan.acceptanceCriteria.join('\n'),
    /supportingStep brand-name/u,
  );
});

test('all fixed positioning keyword groups route in canonical module order', () => {
  const plan = buildBrandTaskPlan(request({
    goal: '明确品类赛道、目标人群、竞争差异和心智关键词',
  }));
  assert.deepEqual(
    plan.selectedModuleIds,
    BRAND_SKILL_MODULES['brand-positioning'],
  );
});

test('visual keywords are case-insensitive and route all matching modules', () => {
  const plan = buildBrandTaskPlan(request({
    skillId: 'brand-visual',
    goal: '升级 LOGO 与 Vi，覆盖门店导视、活动海报、产品包装及 AI视觉生图',
    upstreamArtifacts: [POSITIONING_ARTIFACT],
  }));
  assert.deepEqual(plan.selectedModuleIds, BRAND_SKILL_MODULES['brand-visual']);
});

test('communication keywords route all matching modules', () => {
  const plan = buildBrandTaskPlan(request({
    skillId: 'brand-communication',
    goal: '建立内容母题与企业介绍，策划周年联名品牌活动，梳理品牌故事和创始人IP',
    upstreamArtifacts: [POSITIONING_ARTIFACT, VISUAL_ARTIFACT],
  }));
  assert.deepEqual(
    plan.selectedModuleIds,
    BRAND_SKILL_MODULES['brand-communication'],
  );
});

test('unknown skills are rejected', () => {
  assert.throws(
    () => buildBrandTaskPlan(request({ skillId: 'brand-growth' })),
    /unknown skillId/u,
  );
});

test('cross-skill and unknown explicit modules are rejected', () => {
  assert.throws(
    () => buildBrandTaskPlan(request({
      requestedModuleIds: ['audience-positioning', 'brand-story'],
    })),
    /does not belong to skillId/u,
  );
  assert.throws(
    () => buildBrandTaskPlan(request({
      requestedModuleIds: ['unknown-positioning'],
    })),
    /unknown moduleId/u,
  );
});

test('no safe keyword match falls back to the full skill and records the reason', () => {
  const plan = buildBrandTaskPlan(request({
    skillId: 'brand-communication',
    goal: '重新梳理长期品牌方向',
    upstreamArtifacts: [POSITIONING_ARTIFACT, VISUAL_ARTIFACT],
  }));
  assert.deepEqual(
    plan.selectedModuleIds,
    BRAND_SKILL_MODULES['brand-communication'],
  );
  assert.deepEqual(plan.skippedModuleIds, []);
  assert.equal(plan.routingReason, 'full-skill-fallback');
});

test('empty and invalid goals are rejected', () => {
  for (const goal of ['', '   ', null, 42, 'x'.repeat(6001)]) {
    assert.throws(
      () => buildBrandTaskPlan(request({ goal })),
      /goal/u,
    );
  }
});

test('upstream artifacts require exact immutable versions and change the plan hash', () => {
  const artifact = {
    artifactId: 'brand-positioning-core',
    version: 1,
    sha256: SHA_A,
    sourceOrganizationId: 'ai-brand-officer',
  };
  const first = buildBrandTaskPlan(request({
    skillId: 'brand-visual',
    goal: '设计包装',
    upstreamArtifacts: [artifact],
  }));
  const second = buildBrandTaskPlan(request({
    skillId: 'brand-visual',
    goal: '设计包装',
    upstreamArtifacts: [{ ...artifact, version: 2 }],
  }));

  assert.deepEqual(first.upstreamArtifacts, [artifact]);
  assert.notEqual(first.planHash, second.planHash);
  assert.equal(Object.isFrozen(first.upstreamArtifacts), true);
  assert.equal(Object.isFrozen(first.upstreamArtifacts[0]), true);
});

test('invalid and duplicate upstream artifact references are rejected', () => {
  const valid = {
    artifactId: 'positioning-brief',
    version: 1,
    sha256: SHA_A,
    sourceOrganizationId: 'ai-brand-officer',
  };
  for (const upstreamArtifacts of [
    [{ ...valid, version: 0 }],
    [{ ...valid, version: '1' }],
    [{ ...valid, sha256: SHA_A.toUpperCase() }],
    [{ ...valid, sha256: 'abc' }],
    [{ ...valid, extra: true }],
    [valid, { ...valid, sha256: SHA_B }],
  ]) {
    assert.throws(
      () => buildBrandTaskPlan(request({ upstreamArtifacts })),
      /upstream artifact|duplicate/u,
    );
  }
});

test('steps use the fixed order with one execute step per selected module', () => {
  const plan = buildBrandTaskPlan(request());
  assert.deepEqual(plan.steps, [
    'knowledge-preflight',
    'bind-upstream-artifacts',
    'collect-evidence',
    'execute:audience-positioning',
    'execute:differentiation-positioning',
    'rule-review',
    'professional-review',
    'debug-or-package',
  ]);
});

test('required evidence, acceptance, and stop conditions are non-empty and task-related', () => {
  const plan = buildBrandTaskPlan(request());
  assert.ok(plan.requiredEvidence.length >= 4);
  assert.match(
    plan.requiredEvidence.map(({ description }) => description).join('\n'),
    /飞书.*前置|前置.*飞书/u,
  );
  assert.match(
    plan.requiredEvidence.map(({ description }) => description).join('\n'),
    /artifactId@version.*SHA-256/u,
  );
  assert.ok(plan.acceptanceCriteria.length >= 4);
  assert.match(plan.acceptanceCriteria.join('\n'), /规则审核.*专业审核/u);
  assert.match(plan.stopConditions.join('\n'), /三轮/u);
  assert.match(plan.stopConditions.join('\n'), /业务方向/u);
  assert.match(plan.stopConditions.join('\n'), /付费/u);
  assert.match(plan.stopConditions.join('\n'), /对外发布/u);
  assert.match(plan.stopConditions.join('\n'), /权限/u);
});

test('same input has a stable hash while goal and module changes alter it', () => {
  const first = buildBrandTaskPlan(request());
  const repeated = buildBrandTaskPlan(request());
  const changedGoal = buildBrandTaskPlan(request({
    goal: '明确核心客户与竞争差异',
  }));
  const changedModules = buildBrandTaskPlan(request({
    requestedModuleIds: ['mindshare-occupation'],
  }));

  assert.match(first.planHash, /^[a-f0-9]{64}$/u);
  assert.equal(first.planHash, repeated.planHash);
  assert.notEqual(first.planHash, changedGoal.planHash);
  assert.notEqual(first.planHash, changedModules.planHash);
});

test('JSON-safe inputs are accepted without mutation and the returned plan is deeply frozen', () => {
  const availableInputs = {
    nested: {
      list: [null, true, 3.5, 'source'],
    },
  };
  const constraints = {
    maximumRounds: 3,
    channel: 'internal',
  };
  const upstreamArtifacts = [{
    artifactId: 'positioning-brief',
    version: 2,
    sha256: SHA_B,
    sourceOrganizationId: 'ai-brand-officer',
  }];
  const before = structuredClone({
    availableInputs,
    constraints,
    upstreamArtifacts,
  });

  const plan = buildBrandTaskPlan(request({
    availableInputs,
    constraints,
    upstreamArtifacts,
  }));

  assert.deepEqual(
    { availableInputs, constraints, upstreamArtifacts },
    before,
  );
  assert.deepEqual(Object.keys(plan), ROOT_FIELDS);
  assert.equal(Object.hasOwn(plan, 'availableInputs'), false);
  assert.equal(Object.hasOwn(plan, 'constraints'), false);
  assertDeepFrozen(plan);
  assert.throws(() => plan.steps.push('execute:brand-story'), /read only|extensible/u);
});

test('functions, symbols, circular structures, and non-finite numbers are rejected', () => {
  const circular = {};
  circular.self = circular;
  for (const [field, value] of [
    ['availableInputs', { callback() {} }],
    ['availableInputs', { value: Symbol('unsafe') }],
    ['availableInputs', circular],
    ['constraints', { limit: Number.POSITIVE_INFINITY }],
    ['constraints', { ratio: Number.NaN }],
  ]) {
    assert.throws(
      () => buildBrandTaskPlan(request({ [field]: value })),
      /stable JSON|circular|symbol|finite/u,
    );
  }
});

test('unsafe task identity and unknown request fields are rejected', () => {
  assert.throws(
    () => buildBrandTaskPlan(request({ taskId: '../escape' })),
    /taskId/u,
  );
  assert.throws(
    () => buildBrandTaskPlan({ ...request(), hiddenRouter: true }),
    /unknown field/u,
  );
});

test('schema fields, enums, step formats, artifacts, and hash match runtime output', async () => {
  const schema = JSON.parse(await fs.readFile(PLAN_SCHEMA_FILE, 'utf8'));
  const allModules = Object.values(BRAND_SKILL_MODULES).flat();
  const plan = buildBrandTaskPlan(request());

  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.properties), ROOT_FIELDS);
  assert.deepEqual(schema.required, ROOT_FIELDS);
  assert.deepEqual(schema.properties.skillId.enum, Object.keys(BRAND_SKILL_MODULES));
  assert.deepEqual(schema.$defs.moduleId.enum, allModules);
  assert.deepEqual(schema.properties.routingReason.enum, [
    'explicit-modules',
    'goal-keyword-match',
    'full-skill-fallback',
  ]);
  assert.equal(schema.properties.goal.maxLength, 6000);
  assert.equal(schema.properties.goal.pattern, '^\\S(?:[\\s\\S]*\\S)?$');
  assert.equal(schema.properties.selectedModuleIds.minItems, 1);
  assert.equal(schema.properties.steps.minItems, 7);
  assert.equal(schema.properties.steps.maxItems, 11);
  assert.equal(schema.properties.requiredEvidence.minItems, 5);
  assert.equal(schema.properties.requiredEvidence.maxItems, 9);
  assert.equal(schema.properties.acceptanceCriteria.minItems, 5);
  assert.equal(schema.properties.acceptanceCriteria.maxItems, 9);
  assert.equal(schema.properties.stopConditions.minItems, 5);
  assert.equal(schema.properties.stopConditions.maxItems, 5);
  assert.deepEqual(schema.$defs.artifactRef.required, [
    'artifactId',
    'version',
    'sha256',
    'sourceOrganizationId',
  ]);
  assert.equal(schema.$defs.artifactRef.additionalProperties, false);
  assert.equal(
    schema.$defs.artifactRef.properties.version.maximum,
    Number.MAX_SAFE_INTEGER,
  );
  assert.equal(schema.properties.upstreamArtifacts.maxItems, 100);
  assert.equal(schema.properties.planHash.$ref, '#/$defs/sha256');
  assert.deepEqual(Object.keys(plan), Object.keys(schema.properties));
  for (const step of plan.steps) {
    assert.equal(
      schema.properties.steps.items.oneOf.some((part) => (
        part.enum?.includes(step)
        || (part.pattern && new RegExp(part.pattern, 'u').test(step))
      )),
      true,
      `schema rejected runtime step ${step}`,
    );
  }
});

test('a complete generated plan passes standard schema semantics and runtime validation', async () => {
  const schema = JSON.parse(await fs.readFile(PLAN_SCHEMA_FILE, 'utf8'));
  const plan = buildBrandTaskPlan(request({
    skillId: 'brand-visual',
    goal: '视觉体系、门店、海报、包装和AI视觉生图',
    upstreamArtifacts: [POSITIONING_ARTIFACT],
  }));

  assert.equal(schemaAccepts(schema, plan), true);
  assert.equal(validateBrandTaskPlan(plan), true);
});

test('schema conditions reject selected, skipped, and execute modules from another skill', async () => {
  const schema = JSON.parse(await fs.readFile(PLAN_SCHEMA_FILE, 'utf8'));
  const plan = buildBrandTaskPlan(request());

  const crossSelected = structuredClone(plan);
  crossSelected.selectedModuleIds[0] = 'brand-story';
  assert.equal(schemaAccepts(schema, crossSelected), false);

  const crossSkipped = structuredClone(plan);
  crossSkipped.skippedModuleIds[0] = 'product-packaging';
  assert.equal(schemaAccepts(schema, crossSkipped), false);

  const crossExecute = structuredClone(plan);
  crossExecute.steps[3] = 'execute:brand-story';
  assert.equal(schemaAccepts(schema, crossExecute), false);
});

test('schema step branches reject reordered preflight, execute, and review phases', async () => {
  const schema = JSON.parse(await fs.readFile(PLAN_SCHEMA_FILE, 'utf8'));
  const plan = buildBrandTaskPlan(request());

  const swappedPreflight = structuredClone(plan);
  [swappedPreflight.steps[0], swappedPreflight.steps[1]] = [
    swappedPreflight.steps[1],
    swappedPreflight.steps[0],
  ];
  assert.equal(schemaAccepts(schema, swappedPreflight), false);

  const reviewInExecution = structuredClone(plan);
  reviewInExecution.steps[3] = 'rule-review';
  assert.equal(schemaAccepts(schema, reviewInExecution), false);

  const swappedReviews = structuredClone(plan);
  const last = swappedReviews.steps.length - 1;
  [swappedReviews.steps[last - 2], swappedReviews.steps[last - 1]] = [
    swappedReviews.steps[last - 1],
    swappedReviews.steps[last - 2],
  ];
  assert.equal(schemaAccepts(schema, swappedReviews), false);
});

test('runtime validator rejects duplicate artifactId@version with different metadata', () => {
  const plan = buildBrandTaskPlan(request({
    upstreamArtifacts: [{
      artifactId: 'positioning-brief',
      version: 1,
      sha256: SHA_A,
      sourceOrganizationId: 'ai-brand-officer',
    }],
  }));
  const duplicateVersion = structuredClone(plan);
  duplicateVersion.upstreamArtifacts.push({
    artifactId: 'positioning-brief',
    version: 1,
    sha256: SHA_B,
    sourceOrganizationId: 'ai-growth-strategist',
  });

  assert.throws(
    () => validateBrandTaskPlan(duplicateVersion),
    /duplicate upstream artifact/u,
  );
});

test('runtime validator rejects selected-execute mismatch and invalid module partitions', () => {
  const plan = buildBrandTaskPlan(request());

  const executeMismatch = structuredClone(plan);
  executeMismatch.steps[3] = 'execute:mindshare-occupation';
  assert.throws(
    () => validateBrandTaskPlan(executeMismatch),
    /selected modules and execute steps/u,
  );

  const overlap = structuredClone(plan);
  overlap.skippedModuleIds.push('audience-positioning');
  assert.throws(
    () => validateBrandTaskPlan(overlap),
    /selected and skipped modules overlap/u,
  );

  const missingModule = structuredClone(plan);
  missingModule.skippedModuleIds.shift();
  assert.throws(
    () => validateBrandTaskPlan(missingModule),
    /complete skill partition/u,
  );
});

test('schema documents only the cross-field constraints enforced at runtime', async () => {
  const schema = JSON.parse(await fs.readFile(PLAN_SCHEMA_FILE, 'utf8'));
  assert.deepEqual(schema['x-runtimeConstraints'], [
    'selected-execute-correspondence',
    'selected-skipped-partition',
    'unique-upstream-artifact-version',
    'routing-reason-correspondence',
  ]);
  assert.equal(schema.allOf.length, 3);
  assert.equal(schema.properties.steps.oneOf.length, 5);
});

test('routing reason is canonical even when explicit modules equal keyword routing', () => {
  const plan = buildBrandTaskPlan(request({
    goal: '明确用户和差异',
    requestedModuleIds: [
      'differentiation-positioning',
      'audience-positioning',
    ],
  }));

  assert.deepEqual(plan.selectedModuleIds, [
    'differentiation-positioning',
    'audience-positioning',
  ]);
  assert.equal(plan.routingReason, 'goal-keyword-match');
});

test('runtime validation rejects a forged routing reason even with a recomputed hash', () => {
  const plan = buildBrandTaskPlan(request());
  const forged = structuredClone(plan);
  forged.routingReason = 'explicit-modules';
  rehashPlan(forged);

  assert.throws(
    () => validateBrandTaskPlan(forged),
    /routingReason does not match canonical routing/u,
  );
});

test('routing text normalization handles width, whitespace, mixed scripts, and ASCII boundaries', () => {
  const cases = [
    {
      skillId: 'brand-visual',
      goal: 'provide a market audit',
      selected: BRAND_SKILL_MODULES['brand-visual'],
      reason: 'full-skill-fallback',
    },
    {
      skillId: 'brand-visual',
      goal: 'ＡＩ视觉',
      selected: ['ai-visual-generation'],
      reason: 'goal-keyword-match',
    },
    {
      skillId: 'brand-visual',
      goal: 'AI \n  视觉',
      selected: ['ai-visual-generation'],
      reason: 'goal-keyword-match',
    },
    {
      skillId: 'brand-visual',
      goal: 'ＡＩ\u3000视觉',
      selected: ['ai-visual-generation'],
      reason: 'goal-keyword-match',
    },
    {
      skillId: 'brand-communication',
      goal: '创始人IP',
      selected: ['founder-ip-communication'],
      reason: 'goal-keyword-match',
    },
    {
      skillId: 'brand-communication',
      goal: '创始人 IP',
      selected: ['founder-ip-communication'],
      reason: 'goal-keyword-match',
    },
    {
      skillId: 'brand-visual',
      goal: 'LoGo and vI',
      selected: ['visual-identity-system'],
      reason: 'goal-keyword-match',
    },
    {
      skillId: 'brand-visual',
      goal: 'Thai视觉风格',
      selected: BRAND_SKILL_MODULES['brand-visual'],
      reason: 'full-skill-fallback',
    },
    {
      skillId: 'brand-visual',
      goal: 'Thai 视觉风格',
      selected: BRAND_SKILL_MODULES['brand-visual'],
      reason: 'full-skill-fallback',
    },
    {
      skillId: 'brand-communication',
      goal: '创始人iPhone使用习惯',
      selected: BRAND_SKILL_MODULES['brand-communication'],
      reason: 'full-skill-fallback',
    },
    {
      skillId: 'brand-communication',
      goal: '创始人 iPhone 使用习惯',
      selected: BRAND_SKILL_MODULES['brand-communication'],
      reason: 'full-skill-fallback',
    },
  ];

  for (const item of cases) {
    const visualNeedsPositioning = (
      item.skillId === 'brand-visual'
      && item.selected.some((moduleId) => [
        'visual-identity-system',
        'store-identity',
        'product-packaging',
      ].includes(moduleId))
    );
    const communicationNeedsVisual = (
      item.skillId === 'brand-communication'
      && item.selected.some((moduleId) => [
        'content-communication',
        'brand-campaign',
      ].includes(moduleId))
    );
    const upstreamArtifacts = item.skillId === 'brand-communication'
      ? [
        POSITIONING_ARTIFACT,
        ...(communicationNeedsVisual ? [VISUAL_ARTIFACT] : []),
      ]
      : (visualNeedsPositioning ? [POSITIONING_ARTIFACT] : []);
    const plan = buildBrandTaskPlan(request({
      skillId: item.skillId,
      goal: item.goal,
      upstreamArtifacts,
    }));
    assert.deepEqual(plan.selectedModuleIds, item.selected, item.goal);
    assert.equal(plan.routingReason, item.reason, item.goal);
  }
});

test('only undefined uses defaults while explicit null inputs are rejected', () => {
  for (const field of [
    'requestedModuleIds',
    'upstreamArtifacts',
    'availableInputs',
    'constraints',
  ]) {
    assert.throws(
      () => buildBrandTaskPlan(request({ [field]: null })),
      new RegExp(field, 'u'),
    );
  }

  assert.doesNotThrow(() => buildBrandTaskPlan({
    taskId: 'brand-task-defaults',
    enterpriseId: 'enterprise-001',
    businessProjectId: 'brand-project-001',
    skillId: 'brand-positioning',
    goal: '用户与差异',
  }));
});

test('goal length uses Unicode code points and schema rejects boundary whitespace', async () => {
  const schema = JSON.parse(await fs.readFile(PLAN_SCHEMA_FILE, 'utf8'));
  const supplementaryGoal = '😀'.repeat(3000);
  const plan = buildBrandTaskPlan(request({ goal: supplementaryGoal }));
  assert.equal(Array.from(plan.goal).length, 3000);
  assert.equal(schemaAccepts(schema, plan), true);

  assert.throws(
    () => buildBrandTaskPlan(request({ goal: '😀'.repeat(6001) })),
    /6000 code points/u,
  );

  const leadingWhitespace = structuredClone(plan);
  leadingWhitespace.goal = ` ${leadingWhitespace.goal}`;
  rehashPlan(leadingWhitespace);
  assert.equal(schemaAccepts(schema, leadingWhitespace), false);
  assert.throws(
    () => validateBrandTaskPlan(leadingWhitespace),
    /goal must be normalized/u,
  );

  const trailingWhitespace = structuredClone(plan);
  trailingWhitespace.goal = `${trailingWhitespace.goal}\n`;
  rehashPlan(trailingWhitespace);
  assert.equal(schemaAccepts(schema, trailingWhitespace), false);
  assert.throws(
    () => validateBrandTaskPlan(trailingWhitespace),
    /goal must be normalized/u,
  );
});

test('artifact versions must be positive safe integers', () => {
  const artifact = {
    artifactId: 'positioning-brief',
    version: Number.MAX_SAFE_INTEGER + 1,
    sha256: SHA_A,
    sourceOrganizationId: 'ai-brand-officer',
  };
  assert.throws(
    () => buildBrandTaskPlan(request({ upstreamArtifacts: [artifact] })),
    /safe integer/u,
  );
});

test('planner enforces bounded JSON snapshots, nesting depth, and upstream count', () => {
  const tooManyProperties = Object.fromEntries(
    Array.from({ length: 101 }, (_, index) => [`field${index}`, index]),
  );
  const tooDeep = {};
  let cursor = tooDeep;
  for (let depth = 0; depth < 33; depth += 1) {
    cursor.child = {};
    cursor = cursor.child;
  }
  const artifact = {
    artifactId: 'positioning-brief',
    version: 1,
    sha256: SHA_A,
    sourceOrganizationId: 'ai-brand-officer',
  };

  for (const [field, value, pattern] of [
    ['availableInputs', tooManyProperties, /100 properties/u],
    ['constraints', tooDeep, /depth 32/u],
    ['availableInputs', { payload: 'x'.repeat(1024 * 1024) }, /1 MB/u],
    [
      'upstreamArtifacts',
      Array.from(
        { length: 101 },
        (_, index) => ({ ...artifact, artifactId: `artifact-${index}` }),
      ),
      /100 entries/u,
    ],
  ]) {
    assert.throws(
      () => buildBrandTaskPlan(request({ [field]: value })),
      pattern,
    );
  }
});

test('planner rejects accessors without invoking them', () => {
  let accessorReads = 0;
  const availableInputs = {};
  Object.defineProperty(availableInputs, 'secret', {
    enumerable: true,
    get() {
      accessorReads += 1;
      return 'should-not-run';
    },
  });

  assert.throws(
    () => buildBrandTaskPlan(request({ availableInputs })),
    /accessor/u,
  );
  assert.equal(accessorReads, 0);
});
