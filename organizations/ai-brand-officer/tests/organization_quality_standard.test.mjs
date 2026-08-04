import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const ORGANIZATION_ROOT = path.resolve(TEST_DIRECTORY, "..");
const PROJECT_ROOT = path.resolve(ORGANIZATION_ROOT, "..", "..");
const QUALITY_PATH = path.join(
  ORGANIZATION_ROOT,
  "quality",
  "organization-quality.json",
);

const SKILLS = [
  {
    id: "brand-positioning",
    workflow: "workflows/BRAND_POSITIONING_PILOT.md",
    title: "品牌定位",
  },
  {
    id: "brand-visual",
    workflow: "workflows/BRAND_VISUAL_PILOT.md",
    title: "品牌视觉",
  },
  {
    id: "brand-communication",
    workflow: "workflows/BRAND_COMMUNICATION_PILOT.md",
    title: "品牌传播",
  },
];

const QUALITY_KEYS = [
  "schemaVersion",
  "organizationId",
  "declaredRootStatus",
  "acceptsFormalTasks",
  "skills",
  "fast",
  "accurate",
  "stable",
  "knownGaps",
  "nextOrganizationGate",
].sort();

function assertSafeProjectPath(relativePath, label) {
  assert.equal(typeof relativePath, "string", `${label} must be a string`);
  assert.notEqual(relativePath.trim(), "", `${label} must not be empty`);
  assert.equal(relativePath.includes("\\"), false, `${label} must use forward slashes`);
  assert.equal(path.isAbsolute(relativePath), false, `${label} must be relative`);
  const resolved = path.resolve(PROJECT_ROOT, ...relativePath.split("/"));
  const relative = path.relative(PROJECT_ROOT, resolved);
  assert.equal(
    relative.startsWith("..") || path.isAbsolute(relative),
    false,
    `${label} must remain inside the project`,
  );
  return resolved;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

test("each brand skill has an independent complete pilot workflow", async () => {
  for (const skill of SKILLS) {
    const workflowPath = path.join(ORGANIZATION_ROOT, ...skill.workflow.split("/"));
    const workflow = await fs.readFile(workflowPath, "utf8");
    assert.match(workflow, new RegExp(`# ${skill.title}试运行工作流`));
    for (const heading of [
      "适用范围与边界",
      "输入门禁",
      "执行步骤",
      "输出与验收",
      "异常、重试与停止",
      "真实验收边界",
    ]) {
      assert.match(workflow, new RegExp(`^## \\d+\\. ${heading}$`, "mu"));
    }
    assert.match(workflow, /FEISHU_KNOWLEDGE_PREFLIGHT_STANDARD\.md/u);
    assert.match(workflow, /designing/u);
    assert.match(workflow, /acceptsFormalTasks\s*=\s*false/u);
    assert.match(workflow, /最多重试/u);
    assert.match(workflow, /同一根因连续三轮/u);
    assert.match(workflow, /真实企业/u);
    assert.match(workflow, /不得正式接单/u);
  }
});

test("organization quality profile has the exact shared shape and safe evidence", async () => {
  const quality = await readJson(QUALITY_PATH);
  assert.deepEqual(Object.keys(quality).sort(), QUALITY_KEYS);
  assert.equal(quality.schemaVersion, 1);
  assert.equal(quality.organizationId, "ai-brand-officer");
  assert.equal(quality.declaredRootStatus, "designing");
  assert.equal(quality.acceptsFormalTasks, false);
  assert.equal(quality.skills.length, 3);

  for (const [index, skill] of quality.skills.entries()) {
    assert.deepEqual(Object.keys(skill), [
      "id",
      "skillPath",
      "workflowPath",
      "runtimePaths",
      "testPaths",
      "evidenceLevel",
      "knownGaps",
      "nextGate",
    ]);
    assert.equal(skill.id, SKILLS[index].id);
    assert.equal(skill.workflowPath.endsWith(SKILLS[index].workflow), true);
    assert.ok(
      ["design", "simulation", "internal_real", "real_accepted"].includes(
        skill.evidenceLevel,
      ),
    );
    assert.ok(skill.runtimePaths.length > 0);
    assert.ok(skill.testPaths.length > 0);
    assert.ok(skill.knownGaps.length > 0);
    assert.equal(typeof skill.nextGate, "string");
    assert.notEqual(skill.nextGate.trim(), "");
    for (const [label, paths] of Object.entries({
      skillPath: [skill.skillPath],
      workflowPath: [skill.workflowPath],
      runtimePaths: skill.runtimePaths,
      testPaths: skill.testPaths,
    })) {
      for (const [pathIndex, relativePath] of paths.entries()) {
        const resolved = assertSafeProjectPath(
          relativePath,
          `skills[${index}].${label}[${pathIndex}]`,
        );
        const stat = await fs.stat(resolved);
        assert.equal(stat.isFile(), true, `${relativePath} must exist`);
      }
    }
  }

  const capabilityShapes = {
    fast: ["boundedDispatch", "reusesSharedRuntime", "evidencePaths"],
    accurate: [
      "separatesEvidence",
      "locksExactDependencies",
      "hasQualityGate",
      "evidencePaths",
    ],
    stable: [
      "persistsState",
      "idempotentResume",
      "boundedRetry",
      "evidencePaths",
    ],
  };
  for (const [capability, keys] of Object.entries(capabilityShapes)) {
    assert.deepEqual(Object.keys(quality[capability]), keys);
    for (const key of keys.filter((key) => key !== "evidencePaths")) {
      assert.equal(
        typeof quality[capability][key],
        "boolean",
        `${capability}.${key} must be boolean`,
      );
    }
    assert.ok(quality[capability].evidencePaths.length > 0);
    for (const [index, relativePath] of quality[
      capability
    ].evidencePaths.entries()) {
      const resolved = assertSafeProjectPath(
        relativePath,
        `${capability}.evidencePaths[${index}]`,
      );
      const stat = await fs.stat(resolved);
      assert.equal(stat.isFile(), true, `${relativePath} must exist`);
    }
  }
  assert.ok(quality.knownGaps.length > 0);
  assert.equal(typeof quality.nextOrganizationGate, "string");
  assert.notEqual(quality.nextOrganizationGate.trim(), "");
});

test("local registration reflects root designing dispatch without claiming formal operation", async () => {
  const [organization, brandOfficer, organizationSchema, brandOfficerSchema] =
    await Promise.all([
      readJson(path.join(ORGANIZATION_ROOT, "config", "organization.json")),
      readJson(path.join(ORGANIZATION_ROOT, "config", "brand-officer.json")),
      readJson(path.join(ORGANIZATION_ROOT, "schemas", "organization.schema.json")),
      readJson(path.join(ORGANIZATION_ROOT, "schemas", "brand-officer.schema.json")),
    ]);
  assert.equal(organization.rootControllerRegistration, "registered_designing");
  assert.equal(brandOfficer.rootControllerRegistration, "registered_designing");
  assert.equal(
    organizationSchema.properties.rootControllerRegistration.const,
    "registered_designing",
  );
  assert.equal(
    brandOfficerSchema.properties.rootControllerRegistration.const,
    "registered_designing",
  );
  assert.equal(organization.peerOrganizationCalls, "contract_only");
  for (const relativePath of [
    "AGENTS.md",
    "ORGANIZATION_DETAILS.md",
    "WORKFLOWS.md",
    "USER_GUIDE.md",
    "ENVIRONMENT.md",
    "DECISIONS.md",
  ]) {
    const text = await fs.readFile(
      path.join(ORGANIZATION_ROOT, relativePath),
      "utf8",
    );
    assert.match(text, /rootControllerRegistration\s*=\s*`?registered_designing`?/u);
    assert.match(text, /designing/u);
    assert.match(text, /acceptsFormalTasks\s*=\s*`?false`?/u);
  }
});
