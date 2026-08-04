import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildBrandEvidenceBundle as runtimeBuildBrandEvidenceBundle,
  validateBrandEvidenceBundle as runtimeValidateBrandEvidenceBundle,
} from '../scripts/brand_evidence_engine.mjs';
import {
  stableSha256,
} from '../scripts/brand_contracts.mjs';
import {
  createKnowledgeContext,
} from '../../../scripts/feishu-commander/knowledge_context.mjs';

const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(
  TEST_ROOT,
  '..',
  'contracts',
  'brand-evidence-bundle.schema.json',
);
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const TASK_IDENTITY = Object.freeze({
  enterpriseId: 'enterprise-001',
  businessProjectId: 'project-001',
  taskId: 'brand-task-001',
});
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
const DEFAULT_SPACES = Object.freeze([
  {
    name: '老雷知识库',
    spaceId: 'space-laolei',
  },
  {
    name: '老雷课件知识库',
    spaceId: 'space-courseware',
  },
]);
const TRUSTED_BY_REQUEST = new WeakMap();
const TRUSTED_BY_BUNDLE = new WeakMap();

function clone(value) {
  const result = structuredClone(value);
  if (TRUSTED_BY_REQUEST.has(value)) {
    TRUSTED_BY_REQUEST.set(result, TRUSTED_BY_REQUEST.get(value));
  }
  if (TRUSTED_BY_BUNDLE.has(value)) {
    TRUSTED_BY_BUNDLE.set(result, TRUSTED_BY_BUNDLE.get(value));
  }
  return result;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function artifact(
  artifactId,
  version,
  digest,
  sourceOrganizationId = 'ai-helmsman',
) {
  return {
    artifactId,
    version,
    sha256: digest,
    sourceOrganizationId,
  };
}

function makeProjectContext(overrides = {}) {
  return {
    schemaVersion: 1,
    taskId: TASK_IDENTITY.taskId,
    enterpriseId: TASK_IDENTITY.enterpriseId,
    businessProjectId: TASK_IDENTITY.businessProjectId,
    projectContextVersion: 3,
    readableArtifacts: [
      artifact('enterprise-strategy', 2, HASH_A),
      artifact('growth-plan', 1, HASH_B, 'ai-growth-strategist'),
    ],
    ...overrides,
  };
}

function matchedSource(overrides = {}) {
  return {
    spaceName: '老雷知识库',
    title: '品牌经营原则',
    url: 'https://example.feishu.cn/wiki/brand-principles',
    token: '',
    docType: 'docx',
    excerpt: '品牌表达必须建立在真实业务事实之上。',
    ...overrides,
  };
}

function makeReceipt(overrides = {}) {
  return createKnowledgeContext({
    schemaVersion: 1,
    requestId: TASK_IDENTITY.taskId,
    generatedAt: '2026-07-29T08:00:00.000Z',
    status: 'matched',
    taskSummary: '形成品牌定位证据包',
    capabilityId: 'brand-positioning',
    spaces: clone(DEFAULT_SPACES),
    queries: ['品牌定位', '目标用户'],
    sources: [matchedSource()],
    unreadCandidates: [],
    degradedReason: '',
    ...overrides,
  });
}

async function createFixture() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'brand-evidence-real-receipt-'),
  );
  const taskRoot = path.join(
    projectRoot,
    'business-projects',
    TASK_IDENTITY.enterpriseId,
    TASK_IDENTITY.businessProjectId,
    'organizations',
    'ai-brand-officer',
    'tasks',
    TASK_IDENTITY.taskId,
  );
  const receiptPath = [
    'business-projects',
    TASK_IDENTITY.enterpriseId,
    TASK_IDENTITY.businessProjectId,
    'organizations',
    'ai-brand-officer',
    'tasks',
    TASK_IDENTITY.taskId,
    'evidence',
    'knowledge',
    'knowledge_context.json',
  ].join('/');
  await fs.mkdir(path.dirname(path.join(projectRoot, receiptPath)), {
    recursive: true,
  });
  return {
    projectRoot,
    taskRoot,
    receiptPath,
    projectContext: makeProjectContext(),
  };
}

async function writeReceipt(
  fixture,
  receipt = makeReceipt(),
  {
    receiptPath = fixture.receiptPath,
    bom = false,
  } = {},
) {
  const text = JSON.stringify(receipt, null, 2);
  const bytes = Buffer.from(`${bom ? '\uFEFF' : ''}${text}`, 'utf8');
  const absolutePath = path.resolve(fixture.projectRoot, receiptPath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, bytes);
  return {
    receiptPath,
    receiptSha256: sha256(bytes),
  };
}

async function makeFixtureInput(
  fixture,
  overrides = {},
  receipt = makeReceipt(),
) {
  const locator = await writeReceipt(fixture, receipt);
  return makeInput(fixture, { feishuPreflight: locator, ...overrides });
}

function makeInput(fixture, overrides = {}) {
  const {
    projectRoot = fixture.projectRoot,
    projectContext = clone(fixture.projectContext),
    feishuPreflight: receiptBinding = {
      receiptPath: fixture.receiptPath,
      receiptSha256: HASH_A,
    },
    ...businessOverrides
  } = overrides;
  const request = {
    taskIdentity: { ...TASK_IDENTITY },
    skillId: 'brand-visual',
    conversationFacts: [
      {
        id: 'conversation-audience',
        claim: '帝王确认首要用户是连锁餐饮创始人。',
        sourceRef: 'conversation:turn-17',
        confidence: 'confirmed',
      },
    ],
    publicSources: [
      {
        id: 'public-market',
        claim: '公开行业报告显示连锁门店数持续增长。',
        url: 'https://example.com/market-report',
        confidence: 'supported',
      },
    ],
    professionalJudgments: [
      {
        id: 'judgment-position',
        category: 'professional-judgment',
        claim: '应优先表达可复制的门店经营方法。',
        sourceRef: 'brand-officer:professional-review',
        confidence: 'supported',
      },
      {
        id: 'assumption-budget',
        category: 'assumption',
        claim: '暂定用户具备年度品牌预算。',
        sourceRef: 'assumption:pending-user-confirmation',
        confidence: 'provisional',
      },
      {
        id: 'unknown-competitor',
        category: 'unknown',
        claim: '尚未确认直接竞品的最新定价。',
        sourceRef: 'unknown:pending-public-verification',
        confidence: 'unknown',
      },
    ],
    ...businessOverrides,
  };
  TRUSTED_BY_REQUEST.set(request, {
    projectRoot,
    projectContext,
    receiptBinding,
  });
  return request;
}

function trustedOptionsFor(value) {
  return TRUSTED_BY_REQUEST.get(value) ?? TRUSTED_BY_BUNDLE.get(value);
}

async function buildBrandEvidenceBundle(request, trustedOptions) {
  const trusted = trustedOptions ?? trustedOptionsFor(request);
  const bundle = await runtimeBuildBrandEvidenceBundle(request, trusted);
  TRUSTED_BY_BUNDLE.set(bundle, trusted);
  return bundle;
}

async function validateBrandEvidenceBundle(bundle, options) {
  let trusted = trustedOptionsFor(bundle);
  if (options !== undefined) {
    if (
      trusted
      && Object.keys(options).length === 1
      && Object.hasOwn(options, 'projectContext')
    ) {
      if (options.projectContext !== undefined) {
        trusted = {
          ...trusted,
          projectContext: options.projectContext,
        };
      }
    } else {
      trusted = options;
    }
  }
  return runtimeValidateBrandEvidenceBundle(bundle, trusted);
}

async function withFixture(operation) {
  const fixture = await createFixture();
  try {
    return await operation(fixture);
  } finally {
    await fs.rm(fixture.projectRoot, { recursive: true, force: true });
  }
}

function findEntry(bundle, evidenceId) {
  return bundle.entries.find((entry) => entry.evidenceId === evidenceId);
}

function rehash(bundle) {
  const { evidenceHash: ignored, ...withoutHash } = bundle;
  bundle.evidenceHash = stableSha256(withoutHash);
  return bundle;
}

test('async build reads a matched receipt, derives Feishu entries, and retains authorization context', async () => {
  await withFixture(async (fixture) => {
    const input = await makeFixtureInput(fixture);
    const bundle = await buildBrandEvidenceBundle(input);

    assert.equal(bundle.skillId, 'brand-visual');
    assert.deepEqual(bundle.sourceOrder, [
      'feishu',
      'conversation',
      'public-web',
    ]);
    assert.equal(bundle.feishuPreflight.status, 'matched');
    assert.equal(
      bundle.feishuPreflight.receiptPath,
      fixture.receiptPath,
    );
    assert.match(
      bundle.feishuPreflight.receiptSha256,
      /^[a-f0-9]{64}$/u,
    );
    assert.equal(bundle.feishuPreflight.requestId, TASK_IDENTITY.taskId);
    assert.equal(
      bundle.feishuPreflight.generatedAt,
      '2026-07-29T08:00:00.000Z',
    );
    assert.deepEqual(bundle.feishuPreflight.spaces, DEFAULT_SPACES);
    assert.deepEqual(bundle.feishuPreflight.queries, [
      '品牌定位',
      '目标用户',
    ]);
    assert.deepEqual(bundle.feishuPreflight.sources, [matchedSource()]);
    assert.equal(bundle.feishuPreflight.degradedReason, '');

    const feishuEntries = bundle.entries.filter(
      (entry) => entry.category === 'feishu',
    );
    assert.equal(feishuEntries.length, 1);
    assert.equal(
      feishuEntries[0].claim,
      '品牌表达必须建立在真实业务事实之上。',
    );
    assert.equal(
      feishuEntries[0].sourceRef,
      'https://example.feishu.cn/wiki/brand-principles',
    );
    assert.deepEqual(bundle.authorizationContext, {
      projectContextVersion: 3,
      readableArtifactsHash: stableSha256(
        makeProjectContext().readableArtifacts,
      ),
    });
    assert.deepEqual(bundle.limitations, []);
    assert.equal(bundle.blocked, false);
    assert.equal(Object.isFrozen(bundle), true);
    assert.equal(Object.isFrozen(bundle.feishuPreflight.sources), true);
    assert.equal(
      await validateBrandEvidenceBundle(bundle, {
        projectContext: input.projectContext,
      }),
      true,
    );
  });
});

test('skillId is required, restricted to brand skills, and remains visible for downstream reconciliation', async () => {
  await withFixture(async (fixture) => {
    const request = await makeFixtureInput(fixture);

    const missing = clone(request);
    delete missing.skillId;
    await assert.rejects(
      buildBrandEvidenceBundle(missing),
      /brand evidence request is missing field: skillId/u,
    );

    const unknown = clone(request);
    unknown.skillId = 'unknown-skill';
    await assert.rejects(
      buildBrandEvidenceBundle(unknown),
      /brand evidence request skillId is invalid/u,
    );

    const bundle = await buildBrandEvidenceBundle(request);
    const changedForDownstreamComparison = clone(bundle);
    changedForDownstreamComparison.skillId = 'brand-positioning';
    rehash(changedForDownstreamComparison);
    assert.equal(
      await validateBrandEvidenceBundle(changedForDownstreamComparison),
      true,
    );
    assert.equal(
      changedForDownstreamComparison.skillId,
      'brand-positioning',
    );
    assert.notEqual(
      changedForDownstreamComparison.evidenceHash,
      bundle.evidenceHash,
    );
  });
});

test('two-layer API requires strict trusted options and request fields cannot override them', async () => {
  await withFixture(async (fixture) => {
    const request = await makeFixtureInput(fixture);
    const trustedOptions = trustedOptionsFor(request);

    await assert.rejects(
      runtimeBuildBrandEvidenceBundle(request),
      /trusted options are required/u,
    );
    await assert.rejects(
      runtimeBuildBrandEvidenceBundle(request, {
        ...trustedOptions,
        callerOverride: true,
      }),
      /trusted options has unknown field: callerOverride/u,
    );

    const forgedRequest = clone(request);
    forgedRequest.projectRoot = path.join(fixture.projectRoot, 'fake-root');
    forgedRequest.projectContext = makeProjectContext({
      projectContextVersion: 999,
    });
    forgedRequest.receiptBinding = {
      receiptPath: 'evidence/fake.json',
      receiptSha256: HASH_C,
    };
    await assert.rejects(
      runtimeBuildBrandEvidenceBundle(forgedRequest, trustedOptions),
      /brand evidence request has unknown field: projectRoot/u,
    );

    const bundle = await runtimeBuildBrandEvidenceBundle(
      request,
      trustedOptions,
    );
    await assert.rejects(
      runtimeValidateBrandEvidenceBundle(bundle),
      /trusted options are required/u,
    );
    await assert.rejects(
      runtimeValidateBrandEvidenceBundle(bundle, {
        projectRoot: trustedOptions.projectRoot,
        projectContext: trustedOptions.projectContext,
      }),
      /trusted options is missing field: receiptBinding/u,
    );
    await assert.rejects(
      runtimeValidateBrandEvidenceBundle(bundle, {
        ...trustedOptions,
        projectRoot: path.join(fixture.projectRoot, 'missing-root'),
      }),
      /projectRoot does not exist/u,
    );
  });
});

test('no_hit and degraded receipts continue with exact fixed limitations', async () => {
  await withFixture(async (fixture) => {
    const noHitInput = await makeFixtureInput(
      fixture,
      {},
      makeReceipt({
        status: 'no_hit',
        sources: [],
        degradedReason: '',
      }),
    );
    const noHit = await buildBrandEvidenceBundle(noHitInput);
    assert.equal(noHit.feishuPreflight.status, 'no_hit');
    assert.deepEqual(noHit.limitations, ['feishu-no-hit']);
    assert.equal(noHit.blocked, false);
    assert.equal(
      noHit.entries.some((entry) => entry.category === 'feishu'),
      false,
    );

    const degradedLocator = await writeReceipt(
      fixture,
      makeReceipt({
        status: 'degraded',
        sources: [],
        degradedReason: 'search timeout',
      }),
      {
        receiptPath: fixture.receiptPath.replace(
          'knowledge_context.json',
          'degraded_context.json',
        ),
      },
    );
    const degraded = await buildBrandEvidenceBundle(makeInput(fixture, {
      feishuPreflight: degradedLocator,
    }));
    assert.equal(degraded.feishuPreflight.status, 'degraded');
    assert.equal(
      degraded.feishuPreflight.degradedReason,
      'search timeout',
    );
    assert.deepEqual(degraded.limitations, ['feishu-degraded']);
    assert.equal(degraded.blocked, false);
  });
});

test('business request rejects caller-reported trust-boundary fields', async () => {
  await withFixture(async (fixture) => {
    const input = await makeFixtureInput(fixture);
    input.projectRoot = fixture.projectRoot;
    input.projectContext = clone(fixture.projectContext);
    input.feishuPreflight = {
      status: 'matched',
      hits: [],
    };
    input.receiptBinding = trustedOptionsFor(input).receiptBinding;
    await assert.rejects(
      buildBrandEvidenceBundle(input),
      /brand evidence request has unknown field: projectRoot/u,
    );
  });
});

test('missing receipt and wrong receipt hash are integrity errors, not degraded status', async () => {
  await withFixture(async (fixture) => {
    const missing = makeInput(fixture, {
      feishuPreflight: {
        receiptPath: fixture.receiptPath.replace(
          'knowledge_context.json',
          'missing.json',
        ),
        receiptSha256: HASH_A,
      },
    });
    await assert.rejects(
      buildBrandEvidenceBundle(missing),
      /knowledge receipt.*does not exist/u,
    );

    const input = await makeFixtureInput(fixture);
    trustedOptionsFor(input).receiptBinding.receiptSha256 = HASH_C;
    await assert.rejects(
      buildBrandEvidenceBundle(input),
      /knowledge receipt SHA-256 mismatch/u,
    );
  });
});

test('receipt path rejects absolute paths, traversal, ADS, trailing spaces, and locations outside the task evidence boundary', async () => {
  await withFixture(async (fixture) => {
    const paths = [
      path.join(fixture.projectRoot, fixture.receiptPath),
      '../outside.json',
      fixture.receiptPath.replace(
        'knowledge_context.json',
        'knowledge_context.json:ads',
      ),
      fixture.receiptPath.replace(
        'knowledge_context.json',
        'knowledge_context.json ',
      ),
      [
        'business-projects',
        TASK_IDENTITY.enterpriseId,
        TASK_IDENTITY.businessProjectId,
        'organizations',
        'ai-brand-officer',
        'tasks',
        TASK_IDENTITY.taskId,
        'other',
        'knowledge_context.json',
      ].join('/'),
    ];
    for (const receiptPath of paths) {
      const input = makeInput(fixture, {
        feishuPreflight: {
          receiptPath,
          receiptSha256: HASH_A,
        },
      });
      await assert.rejects(
        buildBrandEvidenceBundle(input),
        /receiptPath.*safe|knowledge receipt.*task evidence boundary/u,
      );
    }
  });
});

test('receipt path rejects a symlink or junction before reading its target', async (t) => {
  await withFixture(async (fixture) => {
    const outside = await fs.mkdtemp(
      path.join(os.tmpdir(), 'brand-evidence-outside-'),
    );
    try {
      const outsideReceipt = path.join(outside, 'knowledge_context.json');
      const receipt = makeReceipt();
      const bytes = Buffer.from(JSON.stringify(receipt), 'utf8');
      await fs.writeFile(outsideReceipt, bytes);
      const linkPath = path.join(
        fixture.taskRoot,
        'evidence',
        'linked-knowledge',
      );
      try {
        await fs.symlink(outside, linkPath, 'junction');
      } catch (error) {
        if (error?.code === 'EPERM') {
          t.skip('junction creation is unavailable in this environment');
          return;
        }
        throw error;
      }
      const relative = path.relative(
        fixture.projectRoot,
        path.join(linkPath, 'knowledge_context.json'),
      ).split(path.sep).join('/');
      const input = makeInput(fixture, {
        feishuPreflight: {
          receiptPath: relative,
          receiptSha256: sha256(bytes),
        },
      });
      await assert.rejects(
        buildBrandEvidenceBundle(input),
        /symbolic link|reparse point/u,
      );
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});

test('receipt rejects BOM, unknown fields, wrong request identity, and missing default spaces', async () => {
  await withFixture(async (fixture) => {
    const cases = [];

    const bomLocator = await writeReceipt(
      fixture,
      makeReceipt(),
      {
        receiptPath: fixture.receiptPath.replace(
          'knowledge_context.json',
          'bom.json',
        ),
        bom: true,
      },
    );
    cases.push([
      bomLocator,
      /must not contain a BOM/u,
    ]);

    const unknown = {
      ...clone(makeReceipt()),
      untrusted: true,
    };
    cases.push([
      await writeReceipt(fixture, unknown, {
        receiptPath: fixture.receiptPath.replace(
          'knowledge_context.json',
          'unknown.json',
        ),
      }),
      /knowledge receipt has unknown field: untrusted/u,
    ]);

    cases.push([
      await writeReceipt(
        fixture,
        makeReceipt({ requestId: 'other-task' }),
        {
          receiptPath: fixture.receiptPath.replace(
            'knowledge_context.json',
            'wrong-request.json',
          ),
        },
      ),
      /requestId does not match task identity/u,
    ]);

    cases.push([
      await writeReceipt(
        fixture,
        makeReceipt({
          spaces: [{
            name: '老雷知识库',
            spaceId: 'space-laolei',
          }],
        }),
        {
          receiptPath: fixture.receiptPath.replace(
            'knowledge_context.json',
            'missing-space.json',
          ),
        },
      ),
      /spaces must include 老雷课件知识库/u,
    ]);

    for (const [locator, expected] of cases) {
      await assert.rejects(
        buildBrandEvidenceBundle(makeInput(fixture, {
          feishuPreflight: locator,
        })),
        expected,
      );
    }
  });
});

test('receipt rejects invalid UTF-8 even when replacement decoding would produce parseable JSON', async () => {
  await withFixture(async (fixture) => {
    const receiptPath = fixture.receiptPath.replace(
      'knowledge_context.json',
      'invalid-utf8.json',
    );
    const bytes = Buffer.from(JSON.stringify(makeReceipt({
      taskSummary: 'receipt-invalid-byte-marker',
    })), 'utf8');
    const markerOffset = bytes.indexOf(
      Buffer.from('receipt-invalid-byte-marker', 'utf8'),
    );
    assert.notEqual(markerOffset, -1);
    bytes[markerOffset] = 0x80;
    await fs.writeFile(path.join(fixture.projectRoot, receiptPath), bytes);

    await assert.rejects(
      buildBrandEvidenceBundle(makeInput(fixture, {
        feishuPreflight: {
          receiptPath,
          receiptSha256: sha256(bytes),
        },
      })),
      /knowledge receipt UTF-8 encoding is invalid/u,
    );
  });
});

test('formal brand evidence rejects skipped_non_business and fabricated matched receipts', async () => {
  await withFixture(async (fixture) => {
    const skipped = makeReceipt({
      status: 'skipped_non_business',
      sources: [],
    });
    const skippedLocator = await writeReceipt(
      fixture,
      skipped,
      {
        receiptPath: fixture.receiptPath.replace(
          'knowledge_context.json',
          'skipped.json',
        ),
      },
    );
    await assert.rejects(
      buildBrandEvidenceBundle(makeInput(fixture, {
        feishuPreflight: skippedLocator,
      })),
      /skipped_non_business is not allowed/u,
    );

    const fabricatedMatched = {
      ...clone(makeReceipt()),
      sources: [],
    };
    const fabricatedLocator = await writeReceipt(
      fixture,
      fabricatedMatched,
      {
        receiptPath: fixture.receiptPath.replace(
          'knowledge_context.json',
          'fabricated-matched.json',
        ),
      },
    );
    await assert.rejects(
      buildBrandEvidenceBundle(makeInput(fixture, {
        feishuPreflight: fabricatedLocator,
      })),
      /matched knowledge context requires sources/u,
    );
  });
});

test('receipt must be a regular file no larger than one megabyte', async () => {
  await withFixture(async (fixture) => {
    const directoryPath = fixture.receiptPath.replace(
      'knowledge_context.json',
      'directory-receipt',
    );
    await fs.mkdir(path.join(fixture.projectRoot, directoryPath));
    await assert.rejects(
      buildBrandEvidenceBundle(makeInput(fixture, {
        feishuPreflight: {
          receiptPath: directoryPath,
          receiptSha256: HASH_A,
        },
      })),
      /knowledge receipt must be a regular file/u,
    );

    const oversizedPath = fixture.receiptPath.replace(
      'knowledge_context.json',
      'oversized.json',
    );
    const bytes = Buffer.alloc(1024 * 1024 + 1, 0x78);
    await fs.writeFile(path.join(fixture.projectRoot, oversizedPath), bytes);
    await assert.rejects(
      buildBrandEvidenceBundle(makeInput(fixture, {
        feishuPreflight: {
          receiptPath: oversizedPath,
          receiptSha256: sha256(bytes),
        },
      })),
      /knowledge receipt must not exceed 1 MB/u,
    );
  });
});

test('Feishu source uses HTTPS or a legal token and never performs network access', async () => {
  await withFixture(async (fixture) => {
    const tokenReceipt = makeReceipt({
      sources: [matchedSource({
        url: '',
        token: 'wikcn_valid_token-001',
      })],
    });
    const tokenInput = await makeFixtureInput(fixture, {}, tokenReceipt);
    const tokenBundle = await buildBrandEvidenceBundle(tokenInput);
    assert.match(
      tokenBundle.entries.find((entry) => entry.category === 'feishu')
        .sourceRef,
      /^feishu-token:/u,
    );

    for (const source of [
      matchedSource({ url: 'http://example.feishu.cn/doc/1' }),
      matchedSource({ url: 'https://user:pass@example.feishu.cn/doc/1' }),
      matchedSource({ url: 'https://127.0.0.1/doc/1' }),
      matchedSource({ url: 'https://localhost./doc/1' }),
      matchedSource({ url: 'https://foo.localhost./doc/1' }),
      matchedSource({ url: '', token: 'invalid token' }),
    ]) {
      const receiptPath = fixture.receiptPath.replace(
        'knowledge_context.json',
        `invalid-source-${stableSha256(source).slice(0, 8)}.json`,
      );
      const locator = await writeReceipt(
        fixture,
        makeReceipt({ sources: [source] }),
        { receiptPath },
      );
      await assert.rejects(
        buildBrandEvidenceBundle(makeInput(fixture, {
          feishuPreflight: locator,
        })),
        /source URL must be secure HTTPS|source token is invalid/u,
      );
    }
  });
});

test('public web references require secure public HTTPS URLs and are not fetched', async () => {
  await withFixture(async (fixture) => {
    const input = await makeFixtureInput(fixture);
    for (const url of [
      'http://example.com/report',
      'https://user:pass@example.com/report',
      'https://localhost/report',
      'https://localhost./report',
      'https://foo.localhost./report',
      'https://127.0.0.1/report',
      'https://10.0.0.1/report',
      'https://172.16.0.1/report',
      'https://192.168.1.1/report',
      'https://[::1]/report',
    ]) {
      const invalid = clone(input);
      invalid.publicSources[0].url = url;
      await assert.rejects(
        buildBrandEvidenceBundle(invalid),
        /public-web evidence sourceRef must be a secure public HTTPS URL/u,
      );
    }
  });
});

test('authorization context binds project context version and complete readable artifact hash', async () => {
  await withFixture(async (fixture) => {
    const input = await makeFixtureInput(fixture, {
      requestedUpstreamArtifacts: [
        artifact(
          'growth-plan',
          1,
          HASH_B,
          'ai-growth-strategist',
        ),
      ],
    });
    const bundle = await buildBrandEvidenceBundle(input);
    assert.deepEqual(bundle.upstreamArtifacts, [
      artifact(
        'growth-plan',
        1,
        HASH_B,
        'ai-growth-strategist',
      ),
    ]);
    assert.equal(
      bundle.authorizationContext.readableArtifactsHash,
      stableSha256(makeProjectContext().readableArtifacts),
    );

    await assert.rejects(
      runtimeValidateBrandEvidenceBundle(bundle),
      /trusted options are required/u,
    );

    const wrongVersion = makeProjectContext({
      projectContextVersion: 4,
    });
    await assert.rejects(
      validateBrandEvidenceBundle(bundle, {
        projectContext: wrongVersion,
      }),
      /project context version does not match authorizationContext/u,
    );
  });
});

test('validator rejects an added or metadata-drifted artifact even after evidence hash recomputation', async () => {
  await withFixture(async (fixture) => {
    const input = await makeFixtureInput(fixture, {
      requestedUpstreamArtifacts: [
        artifact(
          'growth-plan',
          1,
          HASH_B,
          'ai-growth-strategist',
        ),
      ],
    });
    const bundle = await buildBrandEvidenceBundle(input);

    const added = clone(bundle);
    added.upstreamArtifacts.push(
      artifact('unauthorized', 1, HASH_C),
    );
    rehash(added);
    await assert.rejects(
      validateBrandEvidenceBundle(added, {
        projectContext: input.projectContext,
      }),
      /not authorized by project context/u,
    );

    const drifted = clone(bundle);
    drifted.upstreamArtifacts[0].sha256 = HASH_C;
    rehash(drifted);
    await assert.rejects(
      validateBrandEvidenceBundle(drifted, {
        projectContext: input.projectContext,
      }),
      /not authorized by project context/u,
    );
  });
});

test('validator strictly recomputes the fixed limitation array', async () => {
  await withFixture(async (fixture) => {
    const input = await makeFixtureInput(
      fixture,
      {},
      makeReceipt({
        status: 'no_hit',
        sources: [],
      }),
    );
    const bundle = await buildBrandEvidenceBundle(input);

    const extra = clone(bundle);
    extra.limitations.push('invented-limitation');
    rehash(extra);
    await assert.rejects(
      validateBrandEvidenceBundle(extra, {
        projectContext: input.projectContext,
      }),
      /limitations do not match derived state/u,
    );

    const missing = clone(bundle);
    missing.limitations = [];
    rehash(missing);
    await assert.rejects(
      validateBrandEvidenceBundle(missing, {
        projectContext: input.projectContext,
      }),
      /limitations do not match derived state/u,
    );
  });
});

test('critical unknowns alone derive blocked and the final fixed limitation', async () => {
  await withFixture(async (fixture) => {
    const input = await makeFixtureInput(fixture, {
      criticalUnknowns: [{
        id: 'critical-primary-audience',
        criticalField: 'primary-audience',
        description: '首要用户尚未确认。',
        sourceRef: 'unknown:business-owner',
      }],
    }, makeReceipt({
      status: 'degraded',
      sources: [],
      degradedReason: 'search timeout',
    }));
    const bundle = await buildBrandEvidenceBundle(input);
    assert.equal(bundle.blocked, true);
    assert.deepEqual(bundle.limitations, [
      'feishu-degraded',
      'critical-unknowns',
    ]);

    const ordinary = await makeFixtureInput(
      fixture,
      {},
      makeReceipt(),
    );
    const ordinaryBundle = await buildBrandEvidenceBundle(ordinary);
    assert.equal(ordinaryBundle.blocked, false);
    assert.ok(findEntry(ordinaryBundle, 'unknown-competitor'));
  });
});

test('conflicts are recomputed canonically and resolution status only supports unresolved', async () => {
  await withFixture(async (fixture) => {
    const input = await makeFixtureInput(fixture, {
      conversationFacts: [{
        id: 'price-conversation',
        claim: '产品标准价为 99 元。',
        sourceRef: 'conversation:price',
        confidence: 'confirmed',
        claimKey: 'standard-price',
      }],
      publicSources: [{
        id: 'price-public',
        claim: '公开页面显示标准价为 129 元。',
        url: 'https://example.com/price',
        confidence: 'supported',
        claimKey: 'standard-price',
      }],
    });
    const bundle = await buildBrandEvidenceBundle(input);
    assert.equal(bundle.conflicts.length, 1);
    assert.deepEqual(bundle.conflicts[0].evidenceIds, [
      'price-conversation',
      'price-public',
    ]);
    assert.equal(bundle.conflicts[0].resolutionStatus, 'unresolved');

    const deleted = clone(bundle);
    deleted.conflicts = [];
    rehash(deleted);
    await assert.rejects(
      validateBrandEvidenceBundle(deleted, {
        projectContext: input.projectContext,
      }),
      /conflicts do not match entries/u,
    );

    const resolved = clone(bundle);
    resolved.conflicts[0].resolutionStatus = 'resolved';
    rehash(resolved);
    await assert.rejects(
      validateBrandEvidenceBundle(resolved, {
        projectContext: input.projectContext,
      }),
      /resolutionStatus must be unresolved/u,
    );
  });
});

test('entry category semantics are replayed by validator after hash recomputation', async () => {
  await withFixture(async (fixture) => {
    const input = await makeFixtureInput(fixture);
    const bundle = await buildBrandEvidenceBundle(input);

    const conversationUnknown = clone(bundle);
    findEntry(
      conversationUnknown,
      'conversation-audience',
    ).confidence = 'unknown';
    rehash(conversationUnknown);
    await assert.rejects(
      validateBrandEvidenceBundle(conversationUnknown, {
        projectContext: input.projectContext,
      }),
      /conversation evidence confidence must not be unknown/u,
    );

    const assumptionSupported = clone(bundle);
    findEntry(
      assumptionSupported,
      'assumption-budget',
    ).confidence = 'supported';
    rehash(assumptionSupported);
    await assert.rejects(
      validateBrandEvidenceBundle(assumptionSupported, {
        projectContext: input.projectContext,
      }),
      /assumption evidence confidence must be provisional/u,
    );

    const forgedFeishu = clone(bundle);
    forgedFeishu.entries.push({
      evidenceId: 'forged-feishu',
      category: 'feishu',
      claim: '伪造飞书主张。',
      sourceRef: 'https://example.feishu.cn/wiki/forged',
      confidence: 'confirmed',
    });
    rehash(forgedFeishu);
    await assert.rejects(
      validateBrandEvidenceBundle(forgedFeishu, {
        projectContext: input.projectContext,
      }),
      /Feishu evidence entries do not match receipt sources/u,
    );
  });
});

test('independent validator re-reads trusted receipt and rejects a self-consistent forged Feishu bundle', async () => {
  await withFixture(async (fixture) => {
    const request = await makeFixtureInput(fixture);
    const trustedOptions = trustedOptionsFor(request);
    const bundle = await buildBrandEvidenceBundle(request);
    const forged = clone(bundle);
    const forgedSource = {
      ...forged.feishuPreflight.sources[0],
      excerpt: 'Forged but internally self-consistent Feishu claim.',
    };
    forged.feishuPreflight.sources = [forgedSource];
    forged.feishuPreflight.receiptSha256 = HASH_C;
    const forgedEntry = {
      evidenceId: `feishu-${stableSha256(forgedSource).slice(0, 24)}`,
      category: 'feishu',
      claim: forgedSource.excerpt,
      sourceRef: forgedSource.url,
      confidence: 'confirmed',
    };
    forged.entries = forged.entries
      .filter((entry) => entry.category !== 'feishu');
    forged.entries.push(forgedEntry);
    forged.entries.sort((left, right) => {
      const order = [
        'upstream-artifact',
        'feishu',
        'conversation',
        'public-web',
        'professional-judgment',
        'inference',
        'assumption',
        'unknown',
      ];
      return (
        order.indexOf(left.category) - order.indexOf(right.category)
        || left.evidenceId.localeCompare(right.evidenceId, 'en')
      );
    });
    rehash(forged);

    await assert.rejects(
      runtimeValidateBrandEvidenceBundle(forged, trustedOptions),
      /bundle feishuPreflight does not match trusted knowledge receipt/u,
    );
    await assert.rejects(
      runtimeValidateBrandEvidenceBundle(bundle, {
        ...trustedOptions,
        receiptBinding: {
          ...trustedOptions.receiptBinding,
          receiptSha256: HASH_C,
        },
      }),
      /knowledge receipt SHA-256 mismatch/u,
    );
  });
});

test('logical evidence input order is canonical and does not affect bundle or evidence hash', async () => {
  await withFixture(async (fixture) => {
    const input = await makeFixtureInput(fixture, {
      conversationFacts: [
        {
          id: 'conversation-b',
          claim: '事实乙。',
          sourceRef: 'conversation:b',
          confidence: 'confirmed',
        },
        {
          id: 'conversation-a',
          claim: '事实甲。',
          sourceRef: 'conversation:a',
          confidence: 'confirmed',
        },
      ],
      publicSources: [
        {
          id: 'public-b',
          claim: '公开事实乙。',
          url: 'https://example.com/b',
          confidence: 'supported',
        },
        {
          id: 'public-a',
          claim: '公开事实甲。',
          url: 'https://example.com/a',
          confidence: 'supported',
        },
      ],
      professionalJudgments: [
        {
          id: 'judgment-b',
          category: 'professional-judgment',
          claim: '判断乙。',
          sourceRef: 'professional:b',
          confidence: 'supported',
        },
        {
          id: 'judgment-a',
          category: 'professional-judgment',
          claim: '判断甲。',
          sourceRef: 'professional:a',
          confidence: 'supported',
        },
      ],
    });
    const reordered = clone(input);
    reordered.conversationFacts.reverse();
    reordered.publicSources.reverse();
    reordered.professionalJudgments.reverse();

    const first = await buildBrandEvidenceBundle(input);
    const second = await buildBrandEvidenceBundle(reordered);
    assert.deepEqual(second, first);
    assert.equal(second.evidenceHash, first.evidenceHash);
    assert.deepEqual(
      first.entries.map((entry) => entry.evidenceId),
      [...first.entries.map((entry) => entry.evidenceId)].sort(
        (left, right) => {
          const leftEntry = findEntry(first, left);
          const rightEntry = findEntry(first, right);
          const order = [
            'upstream-artifact',
            'feishu',
            'conversation',
            'public-web',
            'professional-judgment',
            'inference',
            'assumption',
            'unknown',
          ];
          return (
            order.indexOf(leftEntry.category)
              - order.indexOf(rightEntry.category)
            || left.localeCompare(right, 'en')
          );
        },
      ),
    );
  });
});

test('snapshot rejects Proxy and accessor inputs without invoking traps', async () => {
  await withFixture(async (fixture) => {
    const input = await makeFixtureInput(fixture);
    const counts = {
      get: 0,
      ownKeys: 0,
      getOwnPropertyDescriptor: 0,
      getPrototypeOf: 0,
    };
    const proxy = new Proxy(input, {
      get(target, property, receiver) {
        counts.get += 1;
        return Reflect.get(target, property, receiver);
      },
      ownKeys(target) {
        counts.ownKeys += 1;
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, property) {
        counts.getOwnPropertyDescriptor += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      getPrototypeOf(target) {
        counts.getPrototypeOf += 1;
        return Reflect.getPrototypeOf(target);
      },
    });
    await assert.rejects(
      buildBrandEvidenceBundle(proxy),
      /Proxy inputs are unsupported/u,
    );
    assert.deepEqual(counts, {
      get: 0,
      ownKeys: 0,
      getOwnPropertyDescriptor: 0,
      getPrototypeOf: 0,
    });

    let accessorCalls = 0;
    const accessor = clone(input);
    Object.defineProperty(accessor, 'trap', {
      enumerable: true,
      get() {
        accessorCalls += 1;
        return true;
      },
    });
    await assert.rejects(
      buildBrandEvidenceBundle(accessor),
      /accessor properties are unsupported/u,
    );
    assert.equal(accessorCalls, 0);
  });
});

test('snapshot enforces incremental resource limits before completing a huge clone', async () => {
  await withFixture(async (fixture) => {
    const input = await makeFixtureInput(fixture, {
      conversationFacts: [{
        id: 'oversized',
        claim: '界'.repeat(400_000),
        sourceRef: 'conversation:oversized',
        confidence: 'confirmed',
      }],
    });
    let lateAccessorCalls = 0;
    Object.defineProperty(input.conversationFacts[0], 'lateTrap', {
      enumerable: true,
      get() {
        lateAccessorCalls += 1;
        return 'must-not-run';
      },
    });
    await assert.rejects(
      buildBrandEvidenceBundle(input),
      /snapshot resource limit.*1 MB/u,
    );
    assert.equal(lateAccessorCalls, 0);
  });
});

test('strict request, task identity, project context, and artifact authorization remain enforced', async () => {
  await withFixture(async (fixture) => {
    const input = await makeFixtureInput(fixture);

    const unknown = clone(input);
    unknown.latest = true;
    await assert.rejects(
      buildBrandEvidenceBundle(unknown),
      /brand evidence request has unknown field: latest/u,
    );

    const crossProject = clone(input);
    const crossProjectOptions = clone(trustedOptionsFor(input));
    crossProjectOptions.projectContext.businessProjectId = 'other-project';
    await assert.rejects(
      buildBrandEvidenceBundle(crossProject, crossProjectOptions),
      /businessProjectId does not match task identity/u,
    );

    const unauthorized = clone(input);
    unauthorized.requestedUpstreamArtifacts = [
      artifact('enterprise-strategy', 3, HASH_A),
    ];
    await assert.rejects(
      buildBrandEvidenceBundle(unauthorized),
      /not authorized by project context/u,
    );
  });
});

test('JSON Schema uses the real receipt, authorization, limitation, and unresolved conflict contract', async () => {
  const schema = JSON.parse(await fs.readFile(SCHEMA_PATH, 'utf8'));

  assert.equal(
    schema.$schema,
    'https://json-schema.org/draft/2020-12/schema',
  );
  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(
    [...schema.required].sort(),
    Object.keys(schema.properties).sort(),
  );
  assert.ok(schema.properties.authorizationContext);
  assert.deepEqual(schema.properties.skillId.enum, [
    'brand-positioning',
    'brand-visual',
    'brand-communication',
  ]);
  assert.deepEqual(
    schema.properties.feishuPreflight.properties.status.enum,
    ['matched', 'no_hit', 'degraded'],
  );
  assert.equal(
    Object.hasOwn(
      schema.properties.feishuPreflight.properties,
      'hits',
    ),
    false,
  );
  assert.equal(
    Object.hasOwn(
      schema.properties.feishuPreflight.properties,
      'searchedSpaces',
    ),
    false,
  );
  assert.deepEqual(
    schema.properties.limitations.items.enum,
    ['feishu-no-hit', 'feishu-degraded', 'critical-unknowns'],
  );
  assert.equal(
    schema.properties.conflicts.items.properties.resolutionStatus.const,
    'unresolved',
  );
  assert.deepEqual(
    schema.$defs.knowledgeReceipt.required.sort(),
    [
      'receiptPath',
      'receiptSha256',
      'requestId',
      'generatedAt',
      'status',
      'spaces',
      'queries',
      'sources',
      'degradedReason',
    ].sort(),
  );
  assert.match(
    schema['x-runtimeConstraints'].join(' '),
    /trusted projectContext/u,
  );
  assert.match(
    schema['x-runtimeConstraints'].join(' '),
    /receipt.*SHA-256/u,
  );
  assert.match(
    schema['x-runtimeConstraints'].join(' '),
    /receipt-revalidated-from-trusted-binding/u,
  );
  assert.match(
    schema['x-runtimeConstraints'].join(' '),
    /project-context-revalidated/u,
  );
  assert.deepEqual(RECEIPT_FIELDS, [
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
});
