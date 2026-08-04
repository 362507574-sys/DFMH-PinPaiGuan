import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const ORG_ROOT = path.resolve(TEST_ROOT, "..");
const SKILL_ROOT = path.resolve(TEST_ROOT, "..", "skills", "brand-positioning");

const FILES = {
  skill: path.join(SKILL_ROOT, "SKILL.md"),
  capability: path.join(SKILL_ROOT, "references", "capability-map.md"),
  planning: path.join(SKILL_ROOT, "references", "planning-contract.md"),
  rubric: path.join(SKILL_ROOT, "references", "quality-rubric.md"),
  debugging: path.join(SKILL_ROOT, "references", "debugging-playbook.md"),
  deliverable: path.join(SKILL_ROOT, "references", "deliverable-contract.md"),
  template: path.join(SKILL_ROOT, "assets", "positioning-brief-template.md"),
};

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

function parsePositioningModuleRows(markdown) {
  const heading = "## 模块清单";
  const start = markdown.indexOf(heading);
  const end = start < 0
    ? -1
    : markdown.indexOf("\n## ", start + heading.length);
  const section = start < 0
    ? ""
    : markdown.slice(
      start + heading.length,
      end < 0 ? markdown.length : end,
    );
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

function assertExactPositioningModules(markdown) {
  const rows = parsePositioningModuleRows(markdown);
  assert.equal(rows.length, 4, "capability map must contain exactly four data rows");
  assert.deepEqual(
    rows,
    [
      { name: "品类定位", moduleId: "category-positioning" },
      { name: "用户定位", moduleId: "audience-positioning" },
      { name: "差异化定位", moduleId: "differentiation-positioning" },
      { name: "心智占位", moduleId: "mindshare-occupation" },
    ],
  );
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
      cwd: path.resolve(ORG_ROOT, "..", ".."),
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

test("positioning v2 exposes exactly four named internal modules", async () => {
  const [skill, capability] = await Promise.all([
    readRequired("skill"),
    readRequired("capability"),
  ]);

  const expected = new Map([
    ["品类定位", "category-positioning"],
    ["用户定位", "audience-positioning"],
    ["差异化定位", "differentiation-positioning"],
    ["心智占位", "mindshare-occupation"],
  ]);
  assertExactPositioningModules(capability);
  const injectedFifthRow = capability.replace(
    "\n## 依赖顺序",
    "\n| 命名策略 | `naming-strategy` | 不应存在 | 不应存在 | 不应存在 | 不应存在 | 不应存在 |\n\n## 依赖顺序",
  );
  assert.throws(
    () => assertExactPositioningModules(injectedFifthRow),
    /exactly four data rows/u,
  );

  for (const [name, moduleId] of expected) {
    assert.match(skill, new RegExp(`${name}.*${moduleId}`, "su"));
  }
  assert.match(capability, /触发条件.*必需输入.*自动读取.*输出.*禁止/us);
});

test("supporting steps have fixed routes without becoming a fifth module", async () => {
  const [skill, planning] = await Promise.all([
    readRequired("skill"),
    readRequired("planning"),
  ]);
  assert.match(planning, /supportingSteps.*不是.*新.*模块/us);
  assert.match(planning, /母子品牌.*category-positioning.*differentiation-positioning.*mindshare-occupation/us);
  assert.match(planning, /名称候选.*category-positioning.*mindshare-occupation/us);
  assert.match(planning, /口号.*mindshare-occupation/us);
  assert.match(planning, /新品延伸.*category-positioning.*audience-positioning.*differentiation-positioning/us);
  assert.match(planning, /改变.*主.*心智.*mindshare-occupation/us);
  assert.match(planning, /整体重定位.*四.*模块/us);
  assert.match(planning, /命中多个.*全部保留.*不采用.*第一个.*停止/us);
  assert.match(planning, /规范顺序.*普通定位关键词.*并集/us);
  assert.match(planning, /显式提交模块清单.*缺少任何依赖.*明确拒绝/us);
  assert.match(skill, /supportingSteps.*按.*固定映射/us);
  assert.match(skill, /全部命中.*supportingSteps.*规范顺序并集.*文本先后.*不.*改变/us);
});

test("planning routes only necessary modules and preserves positioning dependencies", async () => {
  const [skill, capability, planning] = await Promise.all([
    readRequired("skill"),
    readRequired("capability"),
    readRequired("planning"),
  ]);

  assert.match(planning, /单项.*只.*必要模块/us);
  assert.match(planning, /新品牌.*整体重定位.*四.*模块/us);
  assert.match(planning, /未选择.*未调用|未调用.*未选择/us);
  assert.match(capability, /品类定位.*先于.*差异化定位.*先于.*心智占位/us);
  assert.match(skill, /按需.*模块|模块.*按需/u);
  assert.match(skill, /使用者.*决策者.*付费者/us);
  assert.match(skill, /category-positioning.*audience-positioning.*differentiation-positioning.*mindshare-occupation/us);
});

test("evidence order, provenance, and candidate limits are explicit", async () => {
  const [skill, planning, deliverable] = await Promise.all([
    readRequired("skill"),
    readRequired("planning"),
    readRequired("deliverable"),
  ]);

  assert.match(skill, /飞书知识库.*对话.*互联网公开/us);
  assert.match(skill, /no_hit.*degraded.*继续.*告知/us);
  assert.match(skill, /artifactId@version.*sha256/us);
  assert.match(skill, /事实.*推断.*假设.*未知/us);
  assert.match(planning, /不可替代事实.*待验证候选/us);
  assert.match(planning, /不.*伪造.*确定结论|不得.*确定结论/us);
  assert.match(deliverable, /upstreamArtifacts.*artifactId.*version.*sha256/us);
  assert.match(deliverable, /evidenceMap.*事实.*推断.*假设.*未知/us);
});

test("quality rubric rejects weak positioning and requires downstream usefulness", async () => {
  const rubric = await readRequired("rubric");

  for (const pattern of [
    /品类.*可理解/u,
    /用户.*具体/u,
    /差异.*可持续/u,
    /每个关键主张.*证据/u,
    /一个.*主要心智/u,
    /指导.*品牌视觉.*品牌传播/us,
    /通用形容词.*失败/us,
    /宽泛人群.*失败/us,
    /多.*心智.*失败/us,
  ]) {
    assert.match(rubric, pattern);
  }
});

test("positioning uses independent reviews and bounded root-cause debugging", async () => {
  const [skill, debugging, deliverable, template] = await Promise.all([
    readRequired("skill"),
    readRequired("debugging"),
    readRequired("deliverable"),
    readRequired("template"),
  ]);

  assert.match(skill, /规则审核.*定位专业审核/us);
  assert.match(deliverable, /ruleReview.*professionalReview/us);
  for (const rootCause of [
    "category-too-new",
    "audience-too-broad",
    "differentiation-generic",
    "mindshare-multiple",
    "evidence-unsupported",
  ]) {
    assert.match(debugging, new RegExp(rootCause, "u"));
  }
  assert.match(debugging, /观察信号.*受影响模块.*修正动作/us);
  assert.match(debugging, /同一根因.*三轮.*停止/us);
  assert.match(debugging, /第四轮.*禁止|禁止.*第四轮/us);
  assert.match(template, /ruleReview.*reviewerId.*reviewerRole.*reviewedAt.*candidateHash.*planHash.*evidenceHash/us);
  assert.match(template, /professionalReview.*reviewerId.*reviewerRole.*reviewedAt.*candidateHash.*planHash.*evidenceHash/us);
  assert.match(deliverable, /两个不同.*reviewerId|reviewerId.*必须不同/us);
  assert.match(deliverable, /专业审核.*只读.*task.*evidence.*candidate.*rubric/us);
});

test("deliverable and template define a two-layer, control-center-only handoff", async () => {
  const [skill, deliverable, template] = await Promise.all([
    readRequired("skill"),
    readRequired("deliverable"),
    readRequired("template"),
  ]);

  for (const field of [
    "taskIdentity",
    "selectedModuleIds",
    "upstreamArtifacts",
    "evidenceMap",
    "primaryMindshare",
    "nonTargetMindshare",
    "ruleReview",
    "professionalReview",
    "humanSummary",
    "systemPackage",
  ]) {
    assert.match(template, new RegExp(field, "u"));
  }
  assert.match(deliverable, /humanSummary.*结论.*依据.*限制.*下一步/us);
  assert.match(deliverable, /systemPackage.*taskIdentity.*selectedModuleIds.*upstreamArtifacts.*evidenceMap/us);
  assert.match(template, /output.*contentJson/us);
  assert.match(template, /businessContent.*facts.*judgments.*assumptions.*unknowns/us);
  assert.match(template, /downstreamInstructions.*forbiddenChanges/us);
  assert.doesNotMatch(template, /mustNotChange/u);
  for (const field of [
    "schemaVersion",
    "artifactVersion",
    "artifactStatus",
    "lifecycleStatus",
    "candidateId",
    "planHash",
    "evidenceHash",
    "candidateHash",
    "reviewHash",
    "debugStateHash",
    "baseCandidateHash",
    "executionContextCommitment",
    "deliveryContextCommitment",
    "evidenceRefs",
    "review",
    "eliminationAndReworkHistory",
    "nextOrganizationRecommendation",
    "debugTrace",
    "packageHash",
  ]) {
    assert.match(template, new RegExp(field, "u"));
  }
  assert.match(deliverable, /业务模板.*正式包.*映射|正式包.*映射/us);
  assert.match(skill, /返回总控/u);
  assert.match(skill, /不得.*shared-artifacts/u);
  assert.match(skill, /不得.*outputs/u);
  assert.match(skill, /不.*发布|不得.*发布/u);
});

test("real positioning packager, review, and debug guards remain executable", () => {
  runExistingBehaviorTest(
    "brand_deliverable_packager.test.mjs",
    "packages a passing candidate into a deeply frozen human and system layer|content hash is stable and changes for every bound upstream layer",
  );
  runExistingBehaviorTest(
    "brand_quality_gate.test.mjs",
    "reviewer bindings and both review identities are mandatory and independent|role reviews are strict and a failed review cannot become candidate ready|validator rejects wrong trusted binding even when review hash is self-consistent",
  );
  runExistingBehaviorTest(
    "brand_debug_controller.test.mjs",
    "three actual applied and failed rounds block without planning a fourth round",
  );
});

test("skill reads maturity from the root authority instead of hardcoding a snapshot", async () => {
  const [skill, registry] = await Promise.all([
    readRequired("skill"),
    fs.readFile(
      path.resolve(
        ORG_ROOT,
        "..",
        "..",
        "control-center",
        "registries",
        "organizations.json",
      ),
      "utf8",
    ),
  ]);
  const authority = JSON.parse(registry).organizations.find(
    ({ id }) => id === "ai-brand-officer",
  );
  assert.ok(authority, "root registry must contain ai-brand-officer");
  assert.match(skill, /control-center\/registries\/organizations\.json/u);
  assert.match(skill, /每次.*读取|实时.*读取/u);
  assert.doesNotMatch(skill, /designing\s*\/|operational\s*\/|acceptsFormalTasks=(?:true|false)/u);
});

test("frontmatter remains a trigger description instead of a workflow shortcut", async () => {
  const skill = await readRequired("skill");
  const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/u)?.[1] ?? "";
  const description = frontmatter.match(/^description:\s*(.+)$/mu)?.[1] ?? "";

  assert.match(frontmatter, /^name: brand-positioning$/mu);
  assert.match(description, /^Use when /u);
  assert.doesNotMatch(description, /先.*再|→|审核|打包|返回总控/u);
});
