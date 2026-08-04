import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const ORG_ROOT = path.resolve(TEST_ROOT, "..");
const PROJECT_ROOT = path.resolve(ORG_ROOT, "..", "..");
const SKILL_ROOT = path.join(ORG_ROOT, "skills", "brand-visual");
const PUBLIC_SKILLS_REGISTRY = path.join(
  PROJECT_ROOT,
  "public-skills",
  "registry.json",
);

const FILES = {
  skill: path.join(SKILL_ROOT, "SKILL.md"),
  capability: path.join(SKILL_ROOT, "references", "capability-map.md"),
  planning: path.join(SKILL_ROOT, "references", "planning-contract.md"),
  rubric: path.join(SKILL_ROOT, "references", "quality-rubric.md"),
  debugging: path.join(SKILL_ROOT, "references", "debugging-playbook.md"),
  posterRubric: path.join(SKILL_ROOT, "references", "poster-quality-rubric.md"),
  deliverable: path.join(SKILL_ROOT, "references", "deliverable-contract.md"),
  strategyTemplate: path.join(SKILL_ROOT, "assets", "visual-strategy-template.md"),
  aestheticTemplate: path.join(SKILL_ROOT, "assets", "aesthetic-profile-template.md"),
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

function assertExactVisualModules(markdown) {
  const rows = parseTableRows(markdown, "## 模块清单");
  assert.equal(rows.length, 5, "capability map must contain exactly five module rows");
  assert.deepEqual(rows, [
    { name: "品牌视觉体系", moduleId: "visual-identity-system" },
    { name: "门店形象", moduleId: "store-identity" },
    { name: "海报设计", moduleId: "poster-art-direction" },
    { name: "产品包装", moduleId: "product-packaging" },
    { name: "AI视觉生成", moduleId: "ai-visual-generation" },
  ]);
}

function parseTopLevelYamlKeys(markdown) {
  const yaml = markdown.match(/```yaml\r?\n([\s\S]*?)\r?\n```/u)?.[1] ?? "";
  return yaml
    .split(/\r?\n/u)
    .filter((line) => /^[A-Za-z][A-Za-z0-9]*:/u.test(line))
    .map((line) => line.slice(0, line.indexOf(":")));
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

function decidePublicCapability(entry, organizationId = "ai-brand-officer") {
  return (
    entry.maturity === "operational"
    && entry.allowedOrganizations.includes(organizationId)
  )
    ? "authorized-task-callable"
    : "not-formal-task-callable";
}

async function readPublicSkillsRegistry() {
  const bytes = await fs.readFile(PUBLIC_SKILLS_REGISTRY);
  const registry = JSON.parse(bytes.toString("utf8"));
  return {
    registry,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

test("visual v2 exposes exactly five named internal modules", async () => {
  const [skill, capability] = await Promise.all([
    readRequired("skill"),
    readRequired("capability"),
  ]);

  assertExactVisualModules(capability);
  const injectedSixth = capability.replace(
    "\n## 模块依赖",
    "\n| 电商套图 | `ecommerce-image-set` | 不应存在 | 不应存在 | 不应存在 | 不应存在 |\n\n## 模块依赖",
  );
  assert.throws(
    () => assertExactVisualModules(injectedSixth),
    /exactly five module rows/u,
  );
  for (const { name, moduleId } of parseTableRows(capability, "## 模块清单")) {
    assert.match(skill, new RegExp(`${name}.*${moduleId}`, "su"));
  }
});

test("each visual module has an executable scope and a closed production boundary", async () => {
  const capability = await readRequired("capability");

  assert.match(capability, /品牌视觉体系.*Logo.*字标.*色彩.*字体.*图形.*图像.*版式.*使用规则/su);
  assert.match(capability, /门店形象.*门头.*导视.*展示.*材质.*灯光/su);
  assert.match(capability, /概念图.*不是.*施工图|概念效果图.*不得.*施工图/su);
  assert.match(capability, /海报设计.*品牌策略简报.*视觉 DNA.*根级公共/su);
  assert.match(capability, /产品包装.*结构.*标签.*法规字段.*印刷/su);
  assert.match(capability, /包装.*无依据.*不.*补造|不得.*补造.*法规字段/su);
  assert.match(capability, /AI视觉生成.*人物.*产品.*素材授权.*生图通道/su);
  assert.match(capability, /AI.*不.*承担.*精确文字|精确文字.*确定性排版/su);
});

test("planning pins exact upstream versions and produces real direction choices", async () => {
  const [skill, planning, template] = await Promise.all([
    readRequired("skill"),
    readRequired("planning"),
    readRequired("strategyTemplate"),
  ]);

  assert.match(skill, /长期资产.*artifactId@version.*sha256/su);
  assert.match(planning, /首次.*建.*体系.*三个真正不同.*方向/su);
  assert.match(planning, /审美.*不确定.*三个真正不同.*方向/su);
  assert.match(planning, /参考图.*先.*提炼.*视觉 DNA/su);
  assert.match(planning, /不得.*current.*latest|禁止.*current.*latest/su);
  assert.match(template, /upstreamArtifacts.*artifactId.*version.*sha256/su);
  assert.match(template, /visualDna.*构图.*光线.*色彩.*字体.*材质.*留白/su);
  assert.match(template, /directionCandidates.*directionId.*assetRef.*imageSha256.*pairwiseDifferenceEvidence/su);
});

test("poster ownership stays split between brand strategy and the root public skill", async () => {
  const [skill, capability, planning, deliverable, posterRubric] = await Promise.all([
    readRequired("skill"),
    readRequired("capability"),
    readRequired("planning"),
    readRequired("deliverable"),
    readRequired("posterRubric"),
  ]);

  for (const body of [skill, capability, planning]) {
    assert.match(body, /skills\/creating-promotional-posters\/SKILL\.md/u);
  }
  assert.match(skill, /公共能力.*不计入.*三个核心/su);
  assert.match(planning, /品牌官.*品牌策略简报.*视觉 DNA.*最终.*否决/su);
  assert.match(planning, /公共.*候选.*返回.*品牌官.*总审/su);
  assert.match(posterRubric, /AI品牌官.*最终质量否决/su);
  assert.match(deliverable, /publicCapabilityHandoff.*creating-promotional-posters/su);
  assert.match(skill, /TAOBAO_ECOMMERCE_IMAGE_SET_PILOT\.md/u);
});

test("public capability handoff follows the root registry and changes decisions with maturity", async () => {
  const [skill, capability, planning, deliverable, template, root] = await Promise.all([
    readRequired("skill"),
    readRequired("capability"),
    readRequired("planning"),
    readRequired("deliverable"),
    readRequired("strategyTemplate"),
    readPublicSkillsRegistry(),
  ]);
  const poster = root.registry.publicSkills.find(
    ({ id }) => id === "public.promotional-poster",
  );
  const taobao = root.registry.publicSkills.find(
    ({ id }) => id === "public.taobao-ecommerce-image-set",
  );

  assert.ok(poster);
  assert.ok(taobao);
  assert.equal(root.registry.version, undefined);
  assert.match(root.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(poster.capabilityId, "promotional-poster");
  assert.equal(poster.maturity, "operational");
  assert.equal(taobao.capabilityId, "taobao-ecommerce");
  assert.equal(taobao.maturity, "pilot");

  for (const body of [skill, capability, planning, deliverable, template]) {
    assert.match(body, /public-skills\/registry\.json/u);
  }
  for (const publicSkillId of [
    "public.promotional-poster",
    "public.taobao-ecommerce-image-set",
  ]) {
    assert.match(skill, new RegExp(publicSkillId.replaceAll(".", "\\."), "u"));
    assert.match(template, new RegExp(publicSkillId.replaceAll(".", "\\."), "u"));
  }
  assert.match(planning, /maturity\s*!==?\s*["`]?operational|maturity.*不等于.*operational/su);
  assert.match(planning, /allowedOrganizations.*ai-brand-officer/su);
  assert.match(deliverable, /registryRef.*path.*versionOrHash.*sha256.*readAt/su);
  assert.match(template, /registryRef.*path.*versionOrHash.*sha256.*readAt/su);
  assert.match(template, /publicSkillId.*capabilityId.*maturity.*decision/su);
  assert.doesNotMatch(skill, /根登记为 `formal`|仍为 `pilot` 公共能力/u);

  assert.equal(decidePublicCapability(poster), "authorized-task-callable");
  assert.equal(decidePublicCapability(taobao), "not-formal-task-callable");
  assert.equal(
    decidePublicCapability({ ...poster, maturity: "pilot" }),
    "not-formal-task-callable",
  );
  assert.equal(
    decidePublicCapability({ ...taobao, maturity: "operational" }),
    "authorized-task-callable",
  );
  assert.equal(
    decidePublicCapability({
      ...poster,
      allowedOrganizations: ["ai-growth-strategist"],
    }),
    "not-formal-task-callable",
  );
});

test("visual quality combines broad brand review with strict poster elimination", async () => {
  const [rubric, posterRubric] = await Promise.all([
    readRequired("rubric"),
    readRequired("posterRubric"),
  ]);

  for (const pattern of [
    /定位承接/u,
    /区别度/u,
    /识别.*延展/u,
    /产品原貌/u,
    /精确文字/u,
    /授权/u,
    /系列一致/u,
    /生产边界/u,
    /视觉 DNA.*对照/u,
    /独立专业审图/u,
  ]) {
    assert.match(rubric, pattern);
  }
  assert.match(rubric, /规则审核.*视觉专业审核/su);
  assert.match(posterRubric, /十项硬否决/u);
  assert.match(posterRubric, /六维 100 分/u);
  assert.match(posterRubric, /80 分以下不得提交/u);

  runExistingBehaviorTest(
    "brand_quality_gate.test.mjs",
    "poster hard veto eliminates 100 points and fixed codes remain complete|poster thresholds use exact thousandths and reject extra decimals|poster dimensions and comparison checks remain strict and failures downgrade",
  );
});

test("debugging uses exactly eight visual root causes and stops the same cause after three rounds", async () => {
  const debugging = await readRequired("debugging");
  const rows = parseTableRows(debugging, "## 根因映射");
  assert.deepEqual(rows.map(({ moduleId }) => moduleId), [
    "positioning-not-translated",
    "visual-direction-generic",
    "reference-dna-missed",
    "hierarchy-unclear",
    "product-fidelity-failure",
    "precise-text-error",
    "series-inconsistent",
    "ai-template-cheapness",
  ]);
  assert.match(debugging, /第一轮.*局部修正.*第二轮.*模块重做.*第三轮.*方法或.*路径切换/su);
  assert.match(debugging, /同一根因.*最多三轮.*停止/su);
  assert.match(debugging, /第四轮.*禁止|禁止.*第四轮/su);

  runExistingBehaviorTest(
    "brand_debug_controller.test.mjs",
    "three actual applied and failed rounds block without planning a fourth round",
  );
});

test("aesthetic profile has a fixed schema and only learns explicit project-scoped feedback", async () => {
  const [skill, template] = await Promise.all([
    readRequired("skill"),
    readRequired("aestheticTemplate"),
  ]);

  assert.deepEqual(parseTopLevelYamlKeys(template), [
    "schemaVersion",
    "enterpriseId",
    "businessProjectId",
    "brandId",
    "approvedCases",
    "rejectedCases",
    "activePreferences",
    "forbiddenDirections",
    "updatedFromExplicitFeedbackOnly",
    "crossProjectReuse",
  ]);
  assert.match(template, /approvedCases:[\s\S]*caseId:[\s\S]*artifactRef:[\s\S]*likedElements:[\s\S]*transferablePrinciples:/u);
  assert.match(template, /rejectedCases:[\s\S]*caseId:[\s\S]*artifactRef:[\s\S]*dislikedElements:[\s\S]*avoidPrinciples:/u);
  assert.match(template, /updatedFromExplicitFeedbackOnly:\s*true/u);
  assert.match(template, /crossProjectReuse:\s*forbidden/u);
  assert.match(template, /只.*明确通过.*明确否决.*写入|明确通过.*否决.*才能写入/su);
  assert.match(template, /沉默.*点击.*不.*推断|不.*从.*沉默.*单次点击.*推断/su);
  assert.match(template, /禁止跨项目自动复用/u);
  assert.match(template, /固定导入快照.*artifactId@version.*sha256/su);
  assert.match(skill, /企业.*项目.*隔离.*审美档案|审美档案.*企业.*项目.*隔离/su);
});

test("deliverable is double-reviewed, two-layered, and returns only to control center", async () => {
  const [skill, deliverable, template] = await Promise.all([
    readRequired("skill"),
    readRequired("deliverable"),
    readRequired("strategyTemplate"),
  ]);

  assert.match(deliverable, /ruleReview.*professionalReview/su);
  assert.match(deliverable, /两个不同.*reviewerId|reviewerId.*必须不同/su);
  assert.match(deliverable, /humanSummary.*结论.*依据.*限制.*下一步/su);
  assert.match(deliverable, /systemPackage.*taskIdentity.*selectedModuleIds.*upstreamArtifacts.*evidenceRefs/su);
  for (const field of [
    "humanSummary",
    "systemPackage",
    "ruleReview",
    "professionalReview",
    "candidateHash",
    "reviewHash",
    "debugStateHash",
    "sha256",
  ]) {
    assert.match(template, new RegExp(field, "u"));
  }
  assert.doesNotMatch(template, /-\s*packageHash：/u);
  assert.match(deliverable, /validateBrandDeliverablePackage/u);
  assert.match(deliverable, /未知.*packageHash.*拒绝|packageHash.*一律拒绝/su);
  assert.match(skill, /返回总控/u);
  assert.match(skill, /不得.*shared-artifacts/u);
  assert.match(skill, /不得.*outputs/u);
  assert.match(skill, /不.*发布|不得.*发布/u);
});

test("skill frontmatter only describes triggers and maturity comes from root authority", async () => {
  const skill = await readRequired("skill");
  const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/u)?.[1] ?? "";
  const description = frontmatter.match(/^description:\s*(.+)$/mu)?.[1] ?? "";

  assert.match(frontmatter, /^name: brand-visual$/mu);
  assert.match(description, /^Use when /u);
  assert.doesNotMatch(description, /先.*再|→|审核|打包|返回总控/u);
  assert.match(skill, /control-center\/registries\/organizations\.json/u);
  assert.match(skill, /每次.*读取|实时.*读取/u);
  assert.doesNotMatch(skill, /designing\s*\/|operational\s*\/|acceptsFormalTasks=(?:true|false)/u);
});

test("visual v3 documents the executable semantic gate instead of trusting candidate claims", async () => {
  const [skill, planning, quality, deliverable, template] = await Promise.all([
    readRequired("skill"),
    readRequired("planning"),
    readRequired("rubric"),
    readRequired("deliverable"),
    readRequired("strategyTemplate"),
  ]);
  assert.match(skill, /brand_visual_semantic_validator\.mjs/u);
  assert.match(skill, /visualPolicyContext.*不可变.*绑定/su);
  assert.match(planning, /visual-identity-system.*store-identity.*product-packaging.*brand-positioning-\*/su);
  assert.match(planning, /临时海报.*AI 探索.*不机械要求/su);
  assert.match(template, /directionCandidates.*assetRef.*imageSha256.*pairwiseDifferenceEvidence/su);
  assert.match(template, /direction-01.*direction-02.*direction-01.*direction-03.*direction-02.*direction-03/su);
  assert.match(quality, /重复图.*漏 pair.*只改说明/u);
  assert.match(template, /controllerTaskAuthorizationRef.*projectFileSha256.*commanderTaskId.*authorized/su);
  assert.match(deliverable, /project\.json\.publicSkillIds/su);
  assert.match(deliverable, /跨项目审美档案.*upstreamArtifacts/su);
});
