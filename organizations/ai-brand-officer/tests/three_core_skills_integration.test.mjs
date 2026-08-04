import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const ORGANIZATION_ROOT = path.resolve(TEST_DIRECTORY, "..");
const PROJECT_ROOT = path.resolve(ORGANIZATION_ROOT, "..", "..");
const ROOT_REGISTRY_PATH = path.join(
  PROJECT_ROOT,
  "control-center",
  "registries",
  "organizations.json",
);
const PUBLIC_REGISTRY_PATH = path.join(
  PROJECT_ROOT,
  "public-skills",
  "registry.json",
);
const SKILL_IDS = Object.freeze([
  "brand-positioning",
  "brand-visual",
  "brand-communication",
]);
const COMMON_COMPONENT_IDS = Object.freeze([
  "brand-task-planner",
  "brand-evidence-engine",
  "brand-quality-gate",
  "brand-debug-controller",
  "brand-deliverable-packager",
]);

async function readJson(relativePath) {
  return JSON.parse(
    await fs.readFile(path.join(ORGANIZATION_ROOT, relativePath), "utf8"),
  );
}

async function readRootRegistry() {
  return JSON.parse(await fs.readFile(ROOT_REGISTRY_PATH, "utf8"));
}

async function readSkill(skillId) {
  return fs.readFile(
    path.join(ORGANIZATION_ROOT, "skills", skillId, "SKILL.md"),
    "utf8",
  );
}

test("exactly three organization Skill directories exist", async () => {
  const entries = await fs.readdir(
    path.join(ORGANIZATION_ROOT, "skills"),
    { withFileTypes: true },
  );
  assert.deepEqual(
    entries.filter((entry) => (
      entry.isDirectory() && !entry.name.startsWith(".")
    )).map(({ name }) => name).sort(),
    [...SKILL_IDS].sort(),
  );
  for (const skillId of SKILL_IDS) {
    for (const relativePath of [
      "SKILL.md",
      "agents/openai.yaml",
      "references/deliverable-contract.md",
    ]) {
      const value = await fs.readFile(
        path.join(ORGANIZATION_ROOT, "skills", skillId, relativePath),
        "utf8",
      );
      assert.notEqual(
        value.trim(),
        "",
        `${skillId}/${relativePath} must be complete`,
      );
    }
  }
});

test("the five shared runtime components are not registered as Skills", async () => {
  const [organization, brandOfficer, rootRegistry] = await Promise.all([
    readJson("config/organization.json"),
    readJson("config/brand-officer.json"),
    readRootRegistry(),
  ]);
  const rootBrandOfficer = rootRegistry.organizations.find(
    ({ id }) => id === "ai-brand-officer",
  );
  const registeredIds = [
    ...organization.coreSkills.map(({ id }) => id),
    ...brandOfficer.capabilities.map(({ id }) => id),
    ...rootBrandOfficer.coreSkills.map(({ id }) => id),
  ];
  assert.deepEqual(
    [...new Set(registeredIds)],
    [...SKILL_IDS],
  );
  for (const componentId of COMMON_COMPONENT_IDS) {
    assert.equal(registeredIds.includes(componentId), false);
  }
});

test("all three Skills bind the same shared planning-to-packaging chain", async () => {
  for (const skillId of SKILL_IDS) {
    const skill = await readSkill(skillId);
    for (const phase of [
      /前置知识检索|飞书知识库/u,
      /任务.*规划|任务规划/su,
      /证据/u,
      /规则审核/u,
      /专业审核/u,
      /返工|调试/u,
      /打包|deliverable_packager|成果包/u,
      /返回总控/u,
    ]) {
      assert.match(skill, phase, `${skillId} is missing shared phase ${phase}`);
    }
    assert.match(skill, /shared\/FEISHU_KNOWLEDGE_PREFLIGHT_STANDARD\.md/u);
  }
});

test("brand visual calls the root public poster Skill without copying it", async () => {
  const [visualSkill, publicRegistry] = await Promise.all([
    readSkill("brand-visual"),
    JSON.parse(await fs.readFile(PUBLIC_REGISTRY_PATH, "utf8")),
  ]);
  const poster = publicRegistry.publicSkills.find(
    ({ id }) => id === "public.promotional-poster",
  );
  assert.ok(poster);
  assert.equal(poster.capabilityId, "promotional-poster");
  assert.match(visualSkill, /public-skills\/registry\.json/u);
  assert.match(visualSkill, /public\.promotional-poster/u);
  assert.match(
    visualSkill,
    /skills\/creating-promotional-posters\/SKILL\.md/u,
  );
  assert.match(visualSkill, /不.*复制.*公共海报|不得.*复制.*公共海报/su);

  const visualFiles = await fs.readdir(
    path.join(ORGANIZATION_ROOT, "skills", "brand-visual"),
    { recursive: true },
  );
  assert.equal(
    visualFiles.some((entry) => (
      String(entry).includes("creating-promotional-posters")
      || String(entry).includes("poster_workflow_gate")
    )),
    false,
  );
});

test("organization-side Skill maturity remains pilot while runtime authority is read dynamically", async () => {
  const [organization, brandOfficer, rootRegistry] = await Promise.all([
    readJson("config/organization.json"),
    readJson("config/brand-officer.json"),
    readRootRegistry(),
  ]);
  assert.deepEqual(
    organization.coreSkills.map(({ id, status }) => ({ id, status })),
    SKILL_IDS.map((id) => ({ id, status: "pilot" })),
  );
  assert.deepEqual(
    brandOfficer.capabilities.map(({ id, status }) => ({ id, status })),
    SKILL_IDS.map((id) => ({ id, status: "pilot" })),
  );

  const rootBrandOfficer = rootRegistry.organizations.find(
    ({ id }) => id === "ai-brand-officer",
  );
  assert.ok(rootBrandOfficer);
  for (const skillId of SKILL_IDS) {
    const skill = await readSkill(skillId);
    assert.match(skill, /control-center\/registries\/organizations\.json/u);
    assert.match(skill, /每次.*读取|实时.*读取/u);
    assert.match(
      skill,
      /不.*硬编码|不得.*硬编码|不把.*写死/u,
    );
    assert.ok(
      rootBrandOfficer.coreSkills.some(({ id }) => id === skillId),
      `${skillId} must be discovered from the root registry`,
    );
  }
});

test("local design registration and root formal readiness are separate authorities", async () => {
  const [organization, rootRegistry, source] = await Promise.all([
    readJson("config/organization.json"),
    readRootRegistry(),
    fs.readFile(fileURLToPath(import.meta.url), "utf8"),
  ]);
  const rootBrandOfficer = rootRegistry.organizations.find(
    ({ id }) => id === "ai-brand-officer",
  );

  assert.equal(
    organization.rootControllerRegistration,
    "registered_designing",
  );
  assert.ok(rootBrandOfficer);
  assert.equal(rootBrandOfficer.status, "designing");
  assert.equal(rootBrandOfficer.acceptsFormalTasks, false);
  assert.equal(
    source.includes([
      "root control connection",
      "resolves dynamically",
      "to not_connected",
    ].join(" ")),
    false,
    "formal readiness must not be renamed to the local registration field",
  );
});

test("the branch does not claim formal intake, publication, or root connection", async () => {
  const [rootRegistry, ...skills] = await Promise.all([
    readRootRegistry(),
    ...SKILL_IDS.map(readSkill),
  ]);
  const rootBrandOfficer = rootRegistry.organizations.find(
    ({ id }) => id === "ai-brand-officer",
  );
  assert.equal(rootBrandOfficer.acceptsFormalTasks, false);
  for (const skill of skills) {
    assert.match(skill, /不得.*正式|不.*正式/su);
    assert.doesNotMatch(
      skill,
      /已正式接单|已正式发布|已连接总控|根注册已完成/u,
    );
    assert.match(skill, /不得.*shared-artifacts|不.*shared-artifacts/su);
  }
});
