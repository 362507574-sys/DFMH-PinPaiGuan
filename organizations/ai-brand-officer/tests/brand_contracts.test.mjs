import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BRAND_SKILL_MODULES,
  assertPlain,
  rejectUnknown,
  safeId,
  stableSha256,
  stableStringify,
  validateTaskIdentity,
} from '../scripts/brand_contracts.mjs';

const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_ROOT = path.resolve(TEST_ROOT, '..', 'contracts');
const SAFE_ID_PATTERN = '^[a-z0-9][a-z0-9._-]{0,127}$';
const WINDOWS_DEVICE_PATTERN =
  '^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\\..*)?$';
const SHA256_PATTERN = '^[a-f0-9]{64}$';
const SCHEMA_FILES = Object.freeze([
  'brand-task-plan.schema.json',
  'brand-evidence-bundle.schema.json',
  'brand-candidate-review.schema.json',
  'brand-debug-state.schema.json',
  'brand-deliverable-package.schema.json',
  'brand-communication-candidate.schema.json',
]);

const EXPECTED_MODULES = Object.freeze({
  'brand-positioning': [
    'category-positioning',
    'audience-positioning',
    'differentiation-positioning',
    'mindshare-occupation',
  ],
  'brand-visual': [
    'visual-identity-system',
    'store-identity',
    'poster-art-direction',
    'product-packaging',
    'ai-visual-generation',
  ],
  'brand-communication': [
    'content-communication',
    'brand-campaign',
    'brand-story',
    'founder-ip-communication',
  ],
});

async function readSchema(fileName) {
  return JSON.parse(await fs.readFile(path.join(CONTRACT_ROOT, fileName), 'utf8'));
}

function stringSchemaAccepts(schema, value) {
  if ((schema.type && schema.type !== 'string') || typeof value !== 'string') {
    return false;
  }
  if (schema.pattern && !(new RegExp(schema.pattern, 'u')).test(value)) return false;
  if (schema.not?.pattern && (new RegExp(schema.not.pattern, 'u')).test(value)) {
    return false;
  }
  if (
    schema.allOf
    && !schema.allOf.every((part) => stringSchemaAccepts(part, value))
  ) {
    return false;
  }
  return true;
}

function collectObjectSchemas(schema, label, results = []) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return results;
  if (schema.type === 'object') results.push({ label, schema });
  for (const keyword of ['properties', '$defs', 'patternProperties']) {
    for (const [key, child] of Object.entries(schema[keyword] ?? {})) {
      collectObjectSchemas(child, `${label}.${keyword}.${key}`, results);
    }
  }
  if (schema.items) collectObjectSchemas(schema.items, `${label}.items`, results);
  for (const keyword of ['allOf', 'anyOf', 'oneOf', 'prefixItems']) {
    (schema[keyword] ?? []).forEach((child, index) => {
      collectObjectSchemas(child, `${label}.${keyword}[${index}]`, results);
    });
  }
  return results;
}

function reviewTraceSchemaAccepts(schema, trace) {
  if (!Array.isArray(trace)) return false;
  if (schema.minItems !== undefined && trace.length < schema.minItems) return false;
  if (schema.maxItems !== undefined && trace.length > schema.maxItems) return false;
  const allowedRoles = schema.items?.properties?.reviewerRole?.enum ?? [];
  if (trace.some((item) => !allowedRoles.includes(item.reviewerRole))) return false;
  for (const constraint of schema.allOf ?? []) {
    const role = constraint.contains?.properties?.reviewerRole?.const;
    const count = trace.filter((item) => item.reviewerRole === role).length;
    if (count < (constraint.minContains ?? 1)) return false;
    if (constraint.maxContains !== undefined && count > constraint.maxContains) {
      return false;
    }
  }
  return true;
}

function reviewTraceEntry(reviewerRole) {
  return {
    reviewerRole,
    passed: true,
    score: 90,
    observations: ['符合要求'],
    failedCriteria: [],
    correctionTargets: [],
  };
}

test('only the three registered brand skills and their 13 internal modules exist', () => {
  assert.deepEqual(BRAND_SKILL_MODULES, EXPECTED_MODULES);
  assert.deepEqual(Object.keys(BRAND_SKILL_MODULES).sort(), [
    'brand-communication',
    'brand-positioning',
    'brand-visual',
  ]);
  assert.equal(Object.values(BRAND_SKILL_MODULES).flat().length, 13);
  assert.equal(Object.isFrozen(BRAND_SKILL_MODULES), true);
  for (const modules of Object.values(BRAND_SKILL_MODULES)) {
    assert.equal(Object.isFrozen(modules), true);
  }
  assert.throws(() => BRAND_SKILL_MODULES['fourth-skill'] = [], TypeError);
  assert.throws(
    () => BRAND_SKILL_MODULES['brand-positioning'].push('extra-module'),
    TypeError,
  );
});

test('task identity accepts exactly three safe ids and returns an immutable value', () => {
  const identity = validateTaskIdentity({
    enterpriseId: 'enterprise-001',
    businessProjectId: 'project.001',
    taskId: 'brand_task-001',
  });
  assert.deepEqual(identity, {
    enterpriseId: 'enterprise-001',
    businessProjectId: 'project.001',
    taskId: 'brand_task-001',
  });
  assert.equal(Object.isFrozen(identity), true);
  assert.throws(() => identity.taskId = 'mutated', TypeError);
});

test('portable safe ids reject uppercase, trailing dots, and Windows device names', async () => {
  const validIds = [
    'a',
    'enterprise-001',
    '20260729-001-brand-runtime',
    'brand_task.001',
  ];
  const invalidIds = [
    'Task-001',
    'CON',
    'con',
    'con.txt',
    'AUX',
    'aux.json',
    'nul',
    'com1',
    'lpt9.log',
    'task.',
    'task ',
  ];
  for (const value of validIds) {
    assert.equal(safeId(value, 'sampleId'), value);
  }
  for (const value of invalidIds) {
    assert.throws(() => safeId(value, 'sampleId'), /sampleId is unsafe/u);
  }

  for (const fileName of SCHEMA_FILES) {
    const schema = await readSchema(fileName);
    const safeIdSchema = schema.$defs.safeId;
    assert.equal(safeIdSchema.pattern, SAFE_ID_PATTERN);
    assert.equal(safeIdSchema.not?.pattern, WINDOWS_DEVICE_PATTERN);
    assert.equal(safeIdSchema.allOf?.[0]?.not?.pattern, '[.]$');
    for (const value of validIds) {
      assert.equal(
        stringSchemaAccepts(safeIdSchema, value),
        true,
        `${fileName} must accept ${value}`,
      );
    }
    for (const value of invalidIds) {
      assert.equal(
        stringSchemaAccepts(safeIdSchema, value),
        false,
        `${fileName} must reject ${value}`,
      );
    }
  }
});

test('task identity rejects unknown fields, missing fields, and unsafe ids', () => {
  assert.throws(
    () => validateTaskIdentity({
      enterpriseId: '../escape',
      businessProjectId: 'project-001',
      taskId: 'brand-task-001',
    }),
    /enterpriseId is unsafe/u,
  );
  assert.throws(
    () => validateTaskIdentity({
      enterpriseId: 'enterprise-001',
      businessProjectId: 'project-001',
      taskId: 'brand-task-001',
      extra: true,
    }),
    /task identity has unknown field: extra/u,
  );
  assert.throws(
    () => validateTaskIdentity({
      enterpriseId: 'enterprise-001',
      businessProjectId: 'project-001',
    }),
    /taskId is unsafe/u,
  );
  for (const unsafe of [
    '',
    '.',
    '..',
    '../escape',
    'nested/path',
    String.raw`nested\path`,
    'white space',
    '-leading',
    'a'.repeat(129),
  ]) {
    assert.throws(() => safeId(unsafe, 'sampleId'), /sampleId is unsafe/u);
  }
});

test('plain object and unknown-field guards reject edge inputs precisely', () => {
  for (const value of [null, [], new Date(), new Map(), Object.create([])]) {
    assert.throws(() => assertPlain(value, 'sample'), /sample must be a plain object/u);
  }
  const nullPrototype = Object.create(null);
  nullPrototype.allowed = true;
  assert.doesNotThrow(() => assertPlain(nullPrototype, 'sample'));
  assert.doesNotThrow(() => rejectUnknown({ allowed: true }, ['allowed'], 'sample'));
  assert.throws(
    () => rejectUnknown({ allowed: true, drift: true }, ['allowed'], 'sample'),
    /sample has unknown field: drift/u,
  );
});

test('stable serialization ignores object insertion order but preserves array order', () => {
  const left = { z: [{ b: 2, a: 1 }], a: { d: 4, c: 3 } };
  const right = { a: { c: 3, d: 4 }, z: [{ a: 1, b: 2 }] };
  assert.equal(stableStringify(left), stableStringify(right));
  assert.equal(stableSha256(left), stableSha256(right));
  assert.notEqual(stableSha256(['first', 'second']), stableSha256(['second', 'first']));
  assert.match(stableSha256({ valid: true }), /^[a-f0-9]{64}$/u);
});

test('stable serialization supports JSON values and rejects ambiguous edge inputs', () => {
  assert.equal(
    stableStringify({ text: '品牌', nil: null, yes: true, count: 1.5 }),
    '{"count":1.5,"nil":null,"text":"品牌","yes":true}',
  );
  for (const value of [
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1n,
    Symbol('unsupported'),
    () => true,
    new Date(),
    [, 'sparse'],
  ]) {
    assert.throws(() => stableStringify(value), /stable JSON/u);
  }
  const circular = {};
  circular.self = circular;
  assert.throws(() => stableStringify(circular), /circular/u);
});

test('stable serialization rejects arrays with extra string or symbol properties', () => {
  const stringProperty = ['ordered'];
  stringProperty.metadata = 'ambiguous';
  assert.throws(() => stableStringify(stringProperty), /stable JSON/u);

  const symbolProperty = ['ordered'];
  symbolProperty[Symbol('metadata')] = 'ambiguous';
  assert.throws(() => stableStringify(symbolProperty), /stable JSON/u);
});

test('all six schemas are strict non-empty JSON Schema 2020-12 contracts', async () => {
  for (const fileName of SCHEMA_FILES) {
    const schema = await readSchema(fileName);
    assert.equal(
      schema.$schema,
      'https://json-schema.org/draft/2020-12/schema',
      `${fileName} must use JSON Schema 2020-12`,
    );
    assert.equal(schema.type, 'object');
    assert.equal(schema.additionalProperties, false);
    assert.ok(Object.keys(schema.properties ?? {}).length >= 3, `${fileName} is empty`);
    assert.deepEqual(
      [...schema.required].sort(),
      Object.keys(schema.properties).sort(),
      `${fileName} root fields must be explicit and required`,
    );
    assert.equal(schema.$defs.safeId.pattern, SAFE_ID_PATTERN);
    assert.equal(schema.$defs.sha256.pattern, SHA256_PATTERN);
    for (const item of collectObjectSchemas(schema, fileName)) {
      assert.equal(
        item.schema.additionalProperties,
        false,
        `${item.label} must reject unknown fields`,
      );
      assert.ok(
        Object.keys(item.schema.properties ?? {}).length
          + Object.keys(item.schema.patternProperties ?? {}).length > 0,
        `${item.label} must not be an empty object shell`,
      );
    }
  }
});

test('schemas expose the fixed task, evidence, review, debug, and delivery vocabulary', async () => {
  const plan = await readSchema('brand-task-plan.schema.json');
  assert.deepEqual(Object.keys(plan.properties).sort(), [
    'acceptanceCriteria',
    'businessProjectId',
    'enterpriseId',
    'goal',
    'initialState',
    'planHash',
    'requiredEvidence',
    'routingReason',
    'schemaVersion',
    'selectedModuleIds',
    'skillId',
    'skippedModuleIds',
    'steps',
    'stopConditions',
    'taskId',
    'upstreamArtifacts',
  ].sort());
  assert.deepEqual(plan.properties.skillId.enum.sort(), Object.keys(EXPECTED_MODULES).sort());
  assert.deepEqual(plan.properties.initialState.enum, ['planning']);

  const evidence = await readSchema('brand-evidence-bundle.schema.json');
  assert.deepEqual(evidence.properties.skillId.enum, [
    'brand-positioning',
    'brand-visual',
    'brand-communication',
  ]);
  assert.deepEqual(evidence.$defs.evidenceEntry.properties.category.enum, [
    'upstream-artifact',
    'feishu',
    'conversation',
    'public-web',
    'professional-judgment',
    'inference',
    'assumption',
    'unknown',
  ]);
  assert.deepEqual(evidence.properties.feishuPreflight.properties.status.enum, [
    'matched',
    'no_hit',
    'degraded',
  ]);

  const review = await readSchema('brand-candidate-review.schema.json');
  assert.deepEqual(review.properties.verdict.enum, [
    'preferred',
    'candidate_ready',
    'rework',
    'eliminated',
  ]);
  assert.deepEqual(
    review.properties.reviewTrace.items.properties.reviewerRole.enum,
    ['rule-engine', 'brand-professional-reviewer'],
  );

  const debug = await readSchema('brand-debug-state.schema.json');
  assert.deepEqual(debug.properties.status.enum, [
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

  const deliverable = await readSchema('brand-deliverable-package.schema.json');
  assert.deepEqual(Object.keys(deliverable.properties).sort(), [
    'humanSummary',
    'sha256',
    'systemPackage',
  ]);
  assert.deepEqual(Object.keys(deliverable.properties.humanSummary.properties).sort(), [
    'basis',
    'conclusion',
    'limitations',
    'nextStep',
  ]);
});

test('candidate review schema requires exactly one review from each independent role', async () => {
  const review = await readSchema('brand-candidate-review.schema.json');
  const traceSchema = review.properties.reviewTrace;
  const rule = reviewTraceEntry('rule-engine');
  const professional = reviewTraceEntry('brand-professional-reviewer');

  assert.equal(traceSchema.minItems, 2);
  assert.equal(traceSchema.maxItems, 2);
  assert.equal(traceSchema.allOf?.length, 2);
  assert.equal(reviewTraceSchemaAccepts(traceSchema, [rule, professional]), true);
  assert.equal(reviewTraceSchemaAccepts(traceSchema, [professional, rule]), true);
  assert.equal(reviewTraceSchemaAccepts(traceSchema, [rule, rule]), false);
  assert.equal(reviewTraceSchemaAccepts(traceSchema, [professional, professional]), false);
  assert.equal(reviewTraceSchemaAccepts(traceSchema, [rule]), false);
  assert.equal(
    reviewTraceSchemaAccepts(traceSchema, [rule, professional, rule]),
    false,
  );
});

test('every declared skillId and moduleId enum matches the runtime registry', async () => {
  const expectedSkills = Object.keys(BRAND_SKILL_MODULES);
  const expectedModules = Object.values(BRAND_SKILL_MODULES).flat();
  let skillEnumCount = 0;
  let moduleEnumCount = 0;

  function inspect(node, location) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    for (const [key, child] of Object.entries(node)) {
      if (key === 'skillId' && Array.isArray(child?.enum)) {
        assert.deepEqual(
          child.enum,
          expectedSkills,
          `${location}.skillId drifted from BRAND_SKILL_MODULES`,
        );
        skillEnumCount += 1;
      }
      if (key === 'moduleId' && Array.isArray(child?.enum)) {
        assert.deepEqual(
          child.enum,
          expectedModules,
          `${location}.moduleId drifted from BRAND_SKILL_MODULES`,
        );
        moduleEnumCount += 1;
      }
      inspect(child, `${location}.${key}`);
    }
  }

  for (const fileName of SCHEMA_FILES) {
    inspect(await readSchema(fileName), fileName);
  }
  assert.ok(skillEnumCount > 0);
  assert.ok(moduleEnumCount > 0);
});
