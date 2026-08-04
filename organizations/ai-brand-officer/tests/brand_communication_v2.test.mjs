import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BRAND_SKILL_MODULES,
} from "../scripts/brand_contracts.mjs";
import {
  buildBrandTaskPlan,
} from "../scripts/brand_task_planner.mjs";

const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const ORG_ROOT = path.resolve(TEST_ROOT, "..");
const PROJECT_ROOT = path.resolve(ORG_ROOT, "..", "..");
const SKILL_ROOT = path.join(ORG_ROOT, "skills", "brand-communication");

const FILES = {
  skill: path.join(SKILL_ROOT, "SKILL.md"),
  capability: path.join(SKILL_ROOT, "references", "capability-map.md"),
  planning: path.join(SKILL_ROOT, "references", "planning-contract.md"),
  rubric: path.join(SKILL_ROOT, "references", "quality-rubric.md"),
  debugging: path.join(SKILL_ROOT, "references", "debugging-playbook.md"),
  deliverable: path.join(SKILL_ROOT, "references", "deliverable-contract.md"),
  template: path.join(SKILL_ROOT, "assets", "communication-brief-template.md"),
};

const EXPECTED_MODULES = Object.freeze([
  Object.freeze({
    name: "内容传播",
    moduleId: "content-communication",
  }),
  Object.freeze({
    name: "品牌营销活动",
    moduleId: "brand-campaign",
  }),
  Object.freeze({
    name: "品牌故事",
    moduleId: "brand-story",
  }),
  Object.freeze({
    name: "创始人IP传播",
    moduleId: "founder-ip-communication",
  }),
]);

const COMMUNICATION_CONTENT_FIELDS = Object.freeze([
  "messageHierarchy",
  "contentPillars",
  "proofLibrary",
  "brandStory",
  "founderIpPosition",
  "campaignMotherIdea",
  "toneAndVoice",
  "forbiddenClaims",
  "visualBindings",
  "channelAdaptationBoundary",
]);
const POSITIONING_ARTIFACT = Object.freeze({
  artifactId: "brand-positioning-v2",
  version: 2,
  sha256: "a".repeat(64),
  sourceOrganizationId: "ai-brand-officer",
});
const VISUAL_ARTIFACT = Object.freeze({
  artifactId: "brand-visual-v2",
  version: 3,
  sha256: "b".repeat(64),
  sourceOrganizationId: "ai-brand-officer",
});

async function readRequired(key) {
  const targetPath = FILES[key];
  let body;
  try {
    body = await fs.readFile(targetPath, "utf8");
  } catch (error) {
    assert.fail(`${path.relative(SKILL_ROOT, targetPath)} must exist: ${error.code}`);
  }
  assert.ok(body.trim().length > 0, `${key} must be non-empty`);
  return body;
}

function parseTableRows(markdown, heading) {
  const start = markdown.indexOf(heading);
  const end = start < 0
    ? -1
    : markdown.indexOf("\n## ", start + heading.length);
  const section = start < 0
    ? ""
    : markdown.slice(start + heading.length, end < 0 ? markdown.length : end);
  return section
    .split(/\r?\n/u)
    .filter((line) => /^\|\s*[^|]+\|\s*`[^`]+`\s*\|/u.test(line))
    .map((line) => {
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      return {
        name: cells[0],
        moduleId: cells[1].replaceAll("`", ""),
      };
    });
}

function parseCommunicationContentFields(markdown) {
  const block = markdown.match(
    /```yaml\r?\ncommunicationContent:\r?\n([\s\S]*?)\r?\n```/u,
  )?.[1] ?? "";
  return block
    .split(/\r?\n/u)
    .filter((line) => /^ {2}[A-Za-z][A-Za-z0-9]*:/u.test(line))
    .map((line) => line.trim().slice(0, line.trim().indexOf(":")));
}

function makePlan(goal, overrides = {}) {
  return buildBrandTaskPlan({
    taskId: "communication-v2-task",
    enterpriseId: "enterprise-001",
    businessProjectId: "20260730-001-communication-v2",
    skillId: "brand-communication",
    goal,
    requestedModuleIds: [],
    availableInputs: {},
    upstreamArtifacts: [
      { ...POSITIONING_ARTIFACT },
      { ...VISUAL_ARTIFACT },
    ],
    constraints: {},
    ...overrides,
  });
}

function runExistingBehaviorTest(fileName, namePattern) {
  const result = spawnSync(
    process.execPath,
    [
      "--test",
      `--test-name-pattern=${namePattern}`,
      path.join(TEST_ROOT, fileName),
    ],
    {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      timeout: 120_000,
    },
  );
  assert.equal(
    result.status,
    0,
    `${fileName} behavior test failed:\n${result.stdout}\n${result.stderr}`,
  );
}

test("communication v2 exposes exactly four named internal modules", async () => {
  const [skill, capability] = await Promise.all([
    readRequired("skill"),
    readRequired("capability"),
  ]);
  const rows = parseTableRows(capability, "## 模块清单");

  assert.deepEqual(rows, EXPECTED_MODULES);
  assert.deepEqual(
    BRAND_SKILL_MODULES["brand-communication"],
    EXPECTED_MODULES.map(({ moduleId }) => moduleId),
  );
  for (const { name, moduleId } of EXPECTED_MODULES) {
    assert.match(skill, new RegExp(`${name}.*${moduleId}`, "su"));
  }
});

test("four modules define executable responsibilities without taking daily operations", async () => {
  const capability = await readRequired("capability");

  assert.match(capability, /内容传播.*品牌信息母体.*内容母题.*语气.*证据.*禁语/su);
  assert.match(capability, /品牌营销活动.*发布.*周年.*联名.*事件.*不.*日常渠道运营/su);
  assert.match(capability, /品牌故事.*真实起源.*冲突.*选择.*价值.*证据.*不.*虚构/su);
  assert.match(capability, /创始人IP传播.*身份定位.*观点边界.*可信证据.*品牌绑定.*不.*日更脚本矩阵/su);
});

test("real planner selects only necessary single and combined communication modules", () => {
  const story = makePlan("基于真实起源和使命梳理品牌故事");
  assert.deepEqual(story.selectedModuleIds, ["brand-story"]);
  assert.deepEqual(story.skippedModuleIds, [
    "content-communication",
    "brand-campaign",
    "founder-ip-communication",
  ]);

  const combined = makePlan("建立内容母题，并策划周年联名品牌活动");
  assert.deepEqual(combined.selectedModuleIds, [
    "content-communication",
    "brand-campaign",
  ]);
  assert.equal(combined.routingReason, "goal-keyword-match");
});

test("pure daily growth requests fail with a machine-readable ownership mismatch", () => {
  assert.throws(
    () => makePlan("制定30天小红书种草、短视频日更、公众号日常和私域投流获客计划"),
    (error) => {
      assert.equal(error.code, "ownership_mismatch");
      assert.equal(error.ownerOrganizationId, "ai-growth-strategist");
      assert.equal(error.receivedSkillId, "brand-communication");
      assert.match(error.message, /ownership mismatch.*ai-growth-strategist/iu);
      return true;
    },
  );
});

test("pure sales requests fail with a machine-readable ownership mismatch", () => {
  assert.throws(
    () => makePlan("编写销售沟通、成交话术、成交脚本和成交策略"),
    (error) => {
      assert.equal(error.code, "ownership_mismatch");
      assert.equal(error.ownerOrganizationId, "ai-deal-officer");
      assert.equal(error.receivedSkillId, "brand-communication");
      assert.match(error.message, /ownership mismatch.*ai-deal-officer/iu);
      return true;
    },
  );
});

test("pure mixed-owner requests return both owners in canonical order regardless of word order", () => {
  for (const goal of [
    "制定小红书种草和投流获客计划，再编写销售沟通与成交脚本",
    "编写成交脚本与销售沟通，再制定投流获客和小红书种草计划",
  ]) {
    assert.throws(
      () => makePlan(goal, { upstreamArtifacts: [] }),
      (error) => {
        assert.equal(error.code, "ownership_mismatch");
        assert.deepEqual(error.ownerOrganizationIds, [
          "ai-growth-strategist",
          "ai-deal-officer",
        ]);
        assert.equal(error.ownerOrganizationId, undefined);
        return true;
      },
    );
  }
});

test("growth ownership is detected from channel and operation sets without treating a bare brand word as a brand module", () => {
  for (const goal of [
    "运营视频号矩阵并安排引流排期",
    "把公众号广告排期与直播投放做成矩阵",
    "品牌方面先做抖音账号运营和信息流广告",
    "安排社群获客、私域引流以及账号日更",
  ]) {
    assert.throws(
      () => makePlan(goal, { upstreamArtifacts: [] }),
      (error) => {
        assert.equal(error.code, "ownership_mismatch", goal);
        assert.equal(
          error.ownerOrganizationId,
          "ai-growth-strategist",
          goal,
        );
        return true;
      },
    );
  }
});

test("negated channel operations do not create a false growth handoff", () => {
  for (const goal of [
    "不要做抖音账号运营，只梳理品牌故事",
    "不做小红书种草和公众号日更，只核实品牌起源",
  ]) {
    const plan = makePlan(goal, {
      upstreamArtifacts: [{ ...POSITIONING_ARTIFACT }],
    });
    assert.deepEqual(plan.selectedModuleIds, ["brand-story"], goal);
    assert.equal(
      plan.acceptanceCriteria.some(
        (item) => item.includes("ai-growth-strategist"),
      ),
      false,
      goal,
    );
  }
});

test("growth ownership requires channel and operation in the same affirmative fragment", () => {
  for (const goal of [
    "抖音只做品牌展示，但小红书不运营",
    "公众号作为品牌资料页，不过暂不投放广告",
    "停止视频号日更，同时取消社群引流",
    "未运营直播账号，避免信息流广告投放",
  ]) {
    const plan = makePlan(goal);
    assert.equal(
      plan.acceptanceCriteria.some(
        (item) => item.includes("ai-growth-strategist"),
      ),
      false,
      goal,
    );
  }
});

test("mixed negative and affirmative fragments count only the affirmative growth request regardless of word order", () => {
  for (const goal of [
    "梳理品牌故事；抖音不运营，但小红书要投放",
    "先安排投放到小红书，不过抖音账号暂不运营；梳理品牌故事",
  ]) {
    const plan = makePlan(goal);
    assert.deepEqual(plan.selectedModuleIds, ["brand-story"], goal);
    assert.equal(
      plan.acceptanceCriteria.filter(
        (item) => item.includes(
          "ownership handoff: ai-growth-strategist",
        ),
      ).length,
      1,
      goal,
    );
  }
});

test("explicit communication modules cannot omit modules required by clear goal signals", () => {
  for (const [goal, requestedModuleIds, missing] of [
    [
      "建立品牌信息母体并梳理品牌故事",
      ["brand-story"],
      "content-communication",
    ],
    [
      "策划周年品牌活动并建立内容母题",
      ["content-communication"],
      "brand-campaign",
    ],
    [
      "梳理品牌故事与创始人IP",
      ["brand-story"],
      "founder-ip-communication",
    ],
  ]) {
    assert.throws(
      () => makePlan(goal, { requestedModuleIds }),
      new RegExp(`requestedModuleIds.*missing.*${missing}`, "iu"),
      goal,
    );
  }
});

test("brand mother system plus daily channels runs only the mother system and records a handoff", () => {
  const plan = makePlan(
    "建立品牌信息母体和内容母题，并适配小红书种草、短视频日更与成交脚本",
  );
  assert.deepEqual(plan.selectedModuleIds, ["content-communication"]);
  assert.deepEqual(plan.skippedModuleIds, [
    "brand-campaign",
    "brand-story",
    "founder-ip-communication",
  ]);
  assert.ok(
    plan.acceptanceCriteria.some(
      (item) => (
        item.includes("ownership handoff")
        && item.includes("ai-growth-strategist")
      ),
    ),
  );
  assert.ok(
    plan.acceptanceCriteria.some(
      (item) => (
        item.includes("ownership handoff")
        && item.includes("ai-deal-officer")
      ),
    ),
  );
});

test("communication planning requires exact positioning and conditional visual artifacts", () => {
  assert.throws(
    () => makePlan("建立内容母题", { upstreamArtifacts: [] }),
    /brand-positioning.*artifact/iu,
  );
  assert.throws(
    () => makePlan("建立内容母题", {
      upstreamArtifacts: [{ ...POSITIONING_ARTIFACT }],
    }),
    /brand-visual.*artifact/iu,
  );
  assert.throws(
    () => makePlan("建立内容母题", {
      upstreamArtifacts: [{
        ...POSITIONING_ARTIFACT,
        artifactId: "positioning-v2",
      }, { ...VISUAL_ARTIFACT }],
    }),
    /brand-positioning.*artifact/iu,
  );
  for (const [artifactId, pattern] of [
    ["brand-positioning-fake", /brand-positioning.*artifact/iu],
    ["brand-visual-fake", /brand-visual.*artifact/iu],
    ["brand-positioning-v2-copy", /brand-positioning.*artifact/iu],
    ["brand-visual-system-copy", /brand-visual.*artifact/iu],
  ]) {
    const isPositioning = artifactId.startsWith("brand-positioning");
    assert.throws(
      () => makePlan("建立内容母题", {
        upstreamArtifacts: [
          {
            ...(isPositioning ? POSITIONING_ARTIFACT : VISUAL_ARTIFACT),
            artifactId,
          },
          ...(isPositioning
            ? [{ ...VISUAL_ARTIFACT }]
            : [{ ...POSITIONING_ARTIFACT }]),
        ],
      }),
      pattern,
      artifactId,
    );
  }
  assert.throws(
    () => makePlan("建立内容母题", {
      upstreamArtifacts: [{
        ...POSITIONING_ARTIFACT,
        sourceOrganizationId: "ai-growth-strategist",
      }, { ...VISUAL_ARTIFACT }],
    }),
    /brand-positioning.*artifact/iu,
  );

  const story = makePlan("梳理品牌故事", {
    upstreamArtifacts: [{ ...POSITIONING_ARTIFACT }],
  });
  assert.deepEqual(story.selectedModuleIds, ["brand-story"]);
  assert.ok(
    story.acceptanceCriteria.some(
      (item) => /brand-visual.*(?:not-applicable|待后续)/iu.test(item),
    ),
  );

  const full = makePlan(
    "建立品牌信息母体、周年品牌活动、品牌故事与创始人IP",
  );
  assert.deepEqual(
    full.selectedModuleIds,
    BRAND_SKILL_MODULES["brand-communication"],
  );
});

test("planning pins confirmed positioning and visual artifacts and never asks for them again", async () => {
  const [skill, planning, deliverable] = await Promise.all([
    readRequired("skill"),
    readRequired("planning"),
    readRequired("deliverable"),
  ]);

  for (const body of [skill, planning, deliverable]) {
    assert.match(body, /artifactId@version.*sha256/su);
    assert.match(body, /不重复.*索要|不得重复.*索要/su);
  }
  assert.match(planning, /品牌定位.*品牌视觉.*精确版本/su);
  assert.match(planning, /缺少.*定位.*视觉.*不.*定稿|不.*定稿.*定位.*视觉/su);
  assert.match(planning, /局部.*品牌故事.*定位.*视觉.*不适用/su);
  assert.match(planning, /current.*latest.*禁止|禁止.*current.*latest/su);
});

test("story and founder work fail closed on invented or unverified experience", async () => {
  const [skill, capability, rubric, deliverable] = await Promise.all([
    readRequired("skill"),
    readRequired("capability"),
    readRequired("rubric"),
    readRequired("deliverable"),
  ]);

  for (const body of [skill, capability, rubric, deliverable]) {
    assert.match(body, /创始人.*证据|证据.*创始人/su);
    assert.match(body, /虚构.*拒绝|不得.*虚构|不.*虚构/su);
  }
  assert.match(capability, /起源.*冲突.*选择.*价值.*证据/su);
  assert.match(deliverable, /无证据.*待验证|待验证.*无证据/su);
});

test("quality uses one core message, trust evidence and strict organization boundaries", async () => {
  const rubric = await readRequired("rubric");

  for (const pattern of [
    /定位一致/u,
    /单一核心信息/u,
    /理解.*记住.*相信/su,
    /承诺.*证据|证据.*承诺/su,
    /故事.*真实/u,
    /创始人.*品牌.*关系/su,
    /增长战略官.*渠道适配/su,
    /不.*保证增长.*成交|不得.*保证增长.*成交/su,
  ]) {
    assert.match(rubric, pattern);
  }
});

test("growth and sales boundaries are explicit positive and negative contracts", async () => {
  const [skill, planning, deliverable, template] = await Promise.all([
    readRequired("skill"),
    readRequired("planning"),
    readRequired("deliverable"),
    readRequired("template"),
  ]);
  const all = [skill, planning, deliverable, template];

  for (const body of all) {
    assert.match(body, /AI品牌官.*(?:母体|母题).*(?:原则|证据).*(?:禁区|禁语)/su);
    assert.match(body, /AI增长战略官.*小红书.*短视频.*公众号.*私域.*选题.*节奏.*运营.*获客/su);
    assert.match(body, /AI成交官.*销售沟通.*成交话术.*成交脚本.*成交策略/su);
    assert.match(body, /不.*(?:小红书种草|短视频日更|公众号日常|私域运营|投流获客)|(?:小红书种草|短视频日更|公众号日常|私域运营|投流获客).*不/su);
  }
  assert.match(skill, /重大品牌传播/u);
  assert.doesNotMatch(
    skill,
    /AI品牌官负责[^；。\r\n]*(?:30天日更|私域运营|投流获客|成交话术|成交脚本)/u,
  );
});

test("template has exactly ten communication content fields plus full package bindings", async () => {
  const [deliverable, template] = await Promise.all([
    readRequired("deliverable"),
    readRequired("template"),
  ]);

  assert.deepEqual(
    parseCommunicationContentFields(template),
    COMMUNICATION_CONTENT_FIELDS,
  );
  for (const field of [
    "taskIdentity",
    "selectedModuleIds",
    "upstreamArtifacts",
    "evidenceMap",
    "ruleReview",
    "professionalReview",
    "humanSummary",
    "systemPackage",
    "output",
    "businessContent",
    "downstreamInstructions",
    "debugTrace",
    "sha256",
  ]) {
    assert.match(template, new RegExp(field, "u"));
  }
  assert.match(deliverable, /业务模板.*正式包.*映射|正式包.*映射/su);
  assert.match(deliverable, /validateBrandDeliverablePackage/u);
  assert.match(deliverable, /两个不同.*reviewerId|reviewerId.*必须不同/su);
});

test("communication debugging defines seven causes and forbids a fourth same-cause round", async () => {
  const debugging = await readRequired("debugging");
  assert.deepEqual(
    parseTableRows(debugging, "## 根因映射").map(({ moduleId }) => moduleId),
    [
      "message-not-positioned",
      "message-too-many",
      "claim-unsupported",
      "story-fabricated",
      "founder-brand-disconnected",
      "growth-boundary-crossed",
      "visual-language-conflict",
    ],
  );
  assert.match(debugging, /第一轮.*局部修正.*第二轮.*模块重做.*第三轮.*方法或.*路径切换/su);
  assert.match(debugging, /同一根因.*三轮.*停止/su);
  assert.match(debugging, /第四轮.*禁止|禁止.*第四轮/su);

  runExistingBehaviorTest(
    "brand_debug_controller.test.mjs",
    "three actual applied and failed rounds block without planning a fourth round",
  );
});

test("real packager and independent-review guards validate communication package structure", () => {
  runExistingBehaviorTest(
    "brand_deliverable_packager.test.mjs",
    "packages a passing candidate into a deeply frozen human and system layer|content hash is stable and changes for every bound upstream layer",
  );
  runExistingBehaviorTest(
    "brand_quality_gate.test.mjs",
    "reviewer bindings and both review identities are mandatory and independent|role reviews are strict and a failed review cannot become candidate ready",
  );
});

test("frontmatter is trigger-only and results return to control center without publication", async () => {
  const skill = await readRequired("skill");
  const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/u)?.[1] ?? "";
  const description = frontmatter.match(/^description:\s*(.+)$/mu)?.[1] ?? "";

  assert.match(frontmatter, /^name: brand-communication$/mu);
  assert.match(description, /^Use when /u);
  assert.doesNotMatch(description, /先.*再|→|打包|返回总控/u);
  assert.match(skill, /返回总控/u);
  assert.match(skill, /不得.*shared-artifacts/u);
  assert.match(skill, /不得.*outputs/u);
  assert.match(skill, /不.*发布|不得.*发布/u);
});
