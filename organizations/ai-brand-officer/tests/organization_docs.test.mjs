import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const ORGANIZATION_ROOT = path.resolve(TEST_DIRECTORY, "..");
const CONTROL_CENTER_ROOT = path.resolve(ORGANIZATION_ROOT, "..", "..");
const ORGANIZATION_REGISTRY_PATH = path.join(
  CONTROL_CENTER_ROOT,
  "control-center",
  "registries",
  "organizations.json",
);
const BASELINE_PATH = path.join(
  ORGANIZATION_ROOT,
  "temp",
  "implementation-baseline",
  "protected-root-files.json",
);
const CHARTER_PATH = path.join(ORGANIZATION_ROOT, "ORGANIZATION.md");
const DETAILS_PATH = path.join(
  ORGANIZATION_ROOT,
  "ORGANIZATION_DETAILS.md",
);
const BEGIN_MARKER =
  "<!-- BEGIN ORGANIZATION-SIDE DETAILS: ai-brand-officer -->";
const END_MARKER =
  "<!-- END ORGANIZATION-SIDE DETAILS: ai-brand-officer -->";

const REQUIRED_DOCUMENTS = [
  "AGENTS.md",
  "ORGANIZATION_DETAILS.md",
  "WORKFLOWS.md",
  "USER_GUIDE.md",
  "DECISIONS.md",
  "ENVIRONMENT.md",
  "TROUBLESHOOTING.md",
  "issues/TEST_ISSUES.md",
  "issues/ISSUE_MANAGEMENT.md",
  "CHANGELOG.md",
];

const FALSE_CLAIM_PATTERNS = [
  /控制中心.{0,16}(?:已经|已|完成).{0,12}(?:连接|接通|上线)/,
  /根(?:级)?路由.{0,16}(?:已经|已|完成).{0,12}(?:修改|改写|接入|实现|生效)/,
  /(?:修改|改写|实现).{0,12}根(?:级)?路由/,
  /淘宝电商套图.{0,25}(?:生产正式能力|正式生产能力|正式交付能力|已经正式|可正式生产)/,
  /品牌官.{0,18}(?:可以|可|已经|已获准).{0,12}正式接单/,
  /帝王验收.{0,24}(?:后|通过).{0,10}(?:直接|即可|就能|自动).{0,14}(?:正式品牌资产|写入.{0,8}outputs|晋级正式)/,
  /acceptsFormalTasks\s*=\s*`?true`?.{0,30}(?:当前|现已|已经)/,
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function countOccurrences(text, value) {
  return text.split(value).length - 1;
}

function containsEquivalentFalseClaim(text) {
  return text
    .split(/[\n。；]/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .some((sentence) => {
      if (
        /不得|不代表|不等于|不能|禁止|拒绝|未(?:获得|达到|完成|接通|上线|修改|改写|接入|实现|生效|接单|晋级)|没有/.test(
          sentence,
        )
      ) {
        return false;
      }
      return FALSE_CLAIM_PATTERNS.some((pattern) => pattern.test(sentence));
    });
}

async function readBaseline() {
  return JSON.parse(await fs.readFile(BASELINE_PATH, "utf8"));
}

async function readRegistryBrandOfficer() {
  const registry = JSON.parse(
    await fs.readFile(ORGANIZATION_REGISTRY_PATH, "utf8"),
  );
  return registry.organizations.find(
    (organization) => organization.id === "ai-brand-officer",
  );
}

async function readDocument(relativePath) {
  return fs.readFile(path.join(ORGANIZATION_ROOT, relativePath), "utf8");
}

async function loadDocuments() {
  const entries = await Promise.all(
    REQUIRED_DOCUMENTS.map(async (relativePath) => [
      relativePath,
      await readDocument(relativePath),
    ]),
  );
  return Object.fromEntries(entries);
}

function validateCharterBytes(currentBytes, baseline) {
  const charter = baseline.rootOwnedOrganizationCharter;
  if (currentBytes.byteLength < charter.originalFileByteLength) {
    return false;
  }

  const originalPrefix = currentBytes.subarray(
    0,
    charter.originalFileByteLength,
  );
  if (
    originalPrefix.byteLength !== charter.originalFileByteLength ||
    sha256(originalPrefix) !== charter.originalFileSha256
  ) {
    return false;
  }

  for (const section of charter.requiredRootOwnedSections) {
    const sectionBytes = originalPrefix.subarray(
      section.byteStart,
      section.byteEnd,
    );
    if (
      sectionBytes.byteLength !== section.byteLength ||
      sha256(sectionBytes) !== section.sha256
    ) {
      return false;
    }
  }

  if (currentBytes.byteLength === charter.originalFileByteLength) {
    return true;
  }

  const suffix = currentBytes
    .subarray(charter.originalFileByteLength)
    .toString("utf8");
  if (
    countOccurrences(suffix, BEGIN_MARKER) !== 1 ||
    countOccurrences(suffix, END_MARKER) !== 1
  ) {
    return false;
  }
  if (!suffix.startsWith(`${BEGIN_MARKER}\n`)) {
    return false;
  }
  const endOffset = suffix.indexOf(END_MARKER);
  if (endOffset <= BEGIN_MARKER.length) {
    return false;
  }
  const trailing = suffix.slice(endOffset + END_MARKER.length);
  return trailing === "" || trailing === "\n";
}

async function createCharterFixture() {
  const fixtureRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "brand-officer-docs-charter-"),
  );
  const fixtureOrganizationRoot = path.join(
    fixtureRoot,
    "organizations",
    "ai-brand-officer",
  );
  const fixtureCharterPath = path.join(
    fixtureOrganizationRoot,
    "ORGANIZATION.md",
  );
  const fixtureDetailsPath = path.join(
    fixtureOrganizationRoot,
    "ORGANIZATION_DETAILS.md",
  );
  await fs.mkdir(fixtureOrganizationRoot, { recursive: true });
  await fs.copyFile(CHARTER_PATH, fixtureCharterPath);
  return {
    fixtureRoot,
    fixtureCharterPath,
    fixtureDetailsPath,
  };
}

async function withCharterFixture(action) {
  const fixture = await createCharterFixture();
  try {
    return await action(fixture);
  } finally {
    await fs.rm(fixture.fixtureRoot, { recursive: true, force: true });
  }
}

test("every required organization document exists and is non-empty", async () => {
  for (const relativePath of REQUIRED_DOCUMENTS) {
    const filePath = path.join(ORGANIZATION_ROOT, relativePath);
    const stat = await fs.stat(filePath);
    assert.equal(stat.isFile(), true, `${relativePath} must be a file`);
    const text = await fs.readFile(filePath, "utf8");
    assert.notEqual(text.trim(), "", `${relativePath} must be non-empty`);
  }
});

test("organization documents lock one control center, five organizations, fifteen core skills, and the brand skill trio", async () => {
  const documents = await loadDocuments();
  const corpus = Object.values(documents).join("\n");
  assert.match(corpus, /一个控制中心/);
  assert.match(corpus, /五个业务组织/);
  assert.match(corpus, /十五个核心技能/);
  assert.match(corpus, /品牌定位/);
  assert.match(corpus, /品牌视觉/);
  assert.match(corpus, /品牌传播/);
});

test("knowledge order is Feishu knowledge, conversation supplement, then public internet research without blocking on no_hit or degraded", async () => {
  const workflows = await readDocument("WORKFLOWS.md");
  const knowledge = workflows.indexOf("飞书知识库");
  const conversation = workflows.indexOf("对话补充");
  const internet = workflows.indexOf("互联网公开检索");
  assert.ok(knowledge >= 0, "Feishu knowledge must be present");
  assert.ok(
    conversation > knowledge,
    "conversation supplements must follow Feishu knowledge",
  );
  assert.ok(
    internet > conversation,
    "public internet research must follow conversation supplements",
  );
  assert.match(workflows, /no_hit/);
  assert.match(workflows, /degraded/);
  assert.match(workflows, /告知/);
  assert.match(workflows, /继续/);
});

test("workflow follows the complete positioning and approval sequence", async () => {
  const workflows = await readDocument("WORKFLOWS.md");
  const orderedSteps = [
    "总控分派",
    "绑定企业与品牌",
    "根级飞书知识前置",
    "对话补充",
    "互联网公开检索",
    "证据分类",
    "品牌定位试运行",
    "协作请求候选",
    "回收并审核协作结果",
    "候选定位",
    "品牌官总审",
    "帝王验收",
    "正式品牌资产",
  ];
  let previousOffset = -1;
  for (const step of orderedSteps) {
    const offset = workflows.indexOf(step, previousOffset + 1);
    assert.ok(offset > previousOffset, `${step} must remain in order`);
    previousOffset = offset;
  }
});

test("AI brand officer is only a control-center-invoked branch with three skills", async () => {
  const agents = await readDocument("AGENTS.md");
  const details = await readDocument("ORGANIZATION_DETAILS.md");
  const workflows = await readDocument("WORKFLOWS.md");
  const guide = await readDocument("USER_GUIDE.md");

  for (const text of [agents, details, workflows, guide]) {
    assert.match(text, /总控.{0,30}调用/u);
    assert.match(text, /业务组织分支|组织分支/u);
    assert.match(text, /品牌定位.{0,80}品牌视觉.{0,80}品牌传播/us);
  }

  const corpus = [agents, details, workflows, guide].join("\n");
  assert.doesNotMatch(corpus, /AI品牌官.{0,20}(?:就是|作为|担任).{0,10}(?:总控|控制中心|主线)/u);
  assert.doesNotMatch(corpus, /AI品牌官(?:负责|管理)(?:根路由|总控路由|五个组织调度)/u);
  assert.doesNotMatch(workflows, /组织直达入口/u);
});

test("documents require enterprise isolation, candidate-formal isolation, and non-transfer of primary responsibility", async () => {
  const corpus = Object.values(await loadDocuments()).join("\n");
  assert.match(corpus, /企业隔离/);
  assert.match(corpus, /候选与正式隔离/);
  assert.match(corpus, /主责不转移/);
});

test("documents preserve real connection states and public capability maturity", async () => {
  const corpus = Object.values(await loadDocuments()).join("\n");
  assert.match(corpus, /rootControllerRegistration\s*=\s*`?registered_designing`?/);
  assert.match(corpus, /peerOrganizationCalls\s*=\s*`?contract_only`?/);
  assert.match(corpus, /普通宣传海报[\s\S]{0,80}formal[\s\S]{0,30}公共能力/);
  assert.match(corpus, /淘宝电商套图[\s\S]{0,80}pilot[\s\S]{0,30}公共能力/);
});

test("root registry directly locks brand officer and all core skills as designing with formal work disabled", async () => {
  const brandOfficer = await readRegistryBrandOfficer();
  assert.ok(brandOfficer, "ai-brand-officer must exist in root registry");
  assert.equal(brandOfficer.status, "designing");
  assert.equal(brandOfficer.acceptsFormalTasks, false);
  assert.deepEqual(
    brandOfficer.coreSkills.map(({ id, status }) => ({ id, status })),
    [
      { id: "brand-positioning", status: "designing" },
      { id: "brand-visual", status: "designing" },
      { id: "brand-communication", status: "designing" },
    ],
  );
});

test("DETAILS, WORKFLOWS, and USER_GUIDE each block formal acceptance and promotion until root operational authorization", async () => {
  for (const relativePath of [
    "ORGANIZATION_DETAILS.md",
    "WORKFLOWS.md",
    "USER_GUIDE.md",
  ]) {
    const text = await readDocument(relativePath);
    assert.match(text, /status\s*=\s*`?designing`?/);
    assert.match(text, /acceptsFormalTasks\s*=\s*`?false`?/);
    assert.match(text, /operational/);
    assert.match(text, /acceptsFormalTasks\s*=\s*`?true`?/);
    assert.match(text, /组织侧候选验证成熟度/);
    assert.match(text, /只能形成候选|仅形成候选/);
    assert.match(text, /不得.{0,30}(?:正式接单|正式晋级|正式品牌资产|正式成果|`outputs\/`)/);
  }
});

test("all three organization-side pilots are explicitly not root authoritative maturity", async () => {
  const details = await readDocument("ORGANIZATION_DETAILS.md");
  assert.match(details, /品牌定位.{0,80}pilot/);
  assert.match(details, /品牌视觉.{0,80}pilot/);
  assert.match(details, /品牌传播.{0,80}pilot/);
  assert.match(details, /组织侧候选验证成熟度/);
  assert.match(details, /不等于.{0,30}根.{0,20}成熟度/);
  assert.match(details, /根权威状态.{0,20}designing/);
});

test("documents do not claim root routing, root dispatcher, formal Taobao capability, completed connections, or formal acceptance", async () => {
  const corpus = Object.values(await loadDocuments()).join("\n");
  const forbiddenClaims = [
    /已修改根(?:级)?路由/,
    /已实现根(?:级)?调度器/,
    /淘宝电商套图(?:已经|已)?(?:是|升级为)?正式\s*Skill/i,
    /控制中心已连接/,
    /同级组织已连接/,
    /rootControllerRegistration\s*=\s*`?connected`?/,
    /peerOrganizationCalls\s*=\s*`?(?:enabled|connected|direct)`?/,
  ];
  for (const forbiddenClaim of forbiddenClaims) {
    assert.doesNotMatch(corpus, forbiddenClaim);
  }
  assert.equal(containsEquivalentFalseClaim(corpus), false);
});

test("equivalent false claims are rejected by structured claim patterns", () => {
  const falseClaimFixtures = [
    "根控制中心现在已经全部接通，可以直接调用。",
    "控制中心完成正式上线连接。",
    "根路由已经完成改写并生效。",
    "本组织实现了新的根级路由。",
    "淘宝电商套图现为正式生产能力。",
    "淘宝电商套图可正式生产并对外交付。",
    "AI品牌官可以承接正式接单。",
    "品牌官已获准正式接单。",
    "帝王验收通过后即可晋级正式品牌资产。",
    "帝王验收后自动写入 outputs 正式成果。",
  ];
  for (const fixture of falseClaimFixtures) {
    assert.equal(
      containsEquivalentFalseClaim(fixture),
      true,
      `false claim must be rejected: ${fixture}`,
    );
  }
});

test("AGENTS inherits root rules, read order, boundaries, four stages, knowledge preflight, and result delegation", async () => {
  const agents = await readDocument("AGENTS.md");
  for (const phrase of [
    "继承",
    "根级 `AGENTS.md`",
    "读取顺序",
    "组织目录边界",
    "阶段零",
    "阶段一",
    "阶段二",
    "阶段三",
    "阶段四",
    "飞书知识前置",
    "结果委托",
  ]) {
    assert.match(agents, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("USER_GUIDE gives non-technical operating and acceptance guidance", async () => {
  const guide = await readDocument("USER_GUIDE.md");
  assert.match(guide, /帝王/);
  assert.match(guide, /只需|只要/);
  assert.match(guide, /验收/);
  assert.match(guide, /无需.*代码/);
});

test("ENVIRONMENT records only actually verified commands and unchanged connection boundaries", async () => {
  const environment = await readDocument("ENVIRONMENT.md");
  assert.match(environment, /实际验证/);
  assert.match(environment, /node --test/);
  assert.match(environment, /check_scope_guard\.ps1/);
  assert.match(environment, /rootControllerRegistration\s*=\s*`?registered_designing`?/);
  assert.match(environment, /peerOrganizationCalls\s*=\s*`?contract_only`?/);
});

test("TROUBLESHOOTING stops after three same-root-cause attempts and covers knowledge degradation plus handoff", async () => {
  const troubleshooting = await readDocument("TROUBLESHOOTING.md");
  assert.match(troubleshooting, /同一根因/);
  assert.match(troubleshooting, /三轮/);
  assert.match(troubleshooting, /停止/);
  assert.match(troubleshooting, /no_hit|degraded/);
  assert.match(troubleshooting, /handoff/i);
});

test("organization issue files remain navigation only and preserve the root issue list as the single source of truth", async () => {
  const testIssues = await readDocument("issues/TEST_ISSUES.md");
  const issueManagement = await readDocument("issues/ISSUE_MANAGEMENT.md");
  for (const text of [testIssues, issueManagement]) {
    assert.match(text, /根级 `issues\/TEST_ISSUES\.md`/);
    assert.match(text, /唯一.*事实源|唯一.*正式问题/);
    assert.match(text, /第二事实源/);
  }
  assert.match(testIssues, /导航|临时发现/);
  assert.match(testIssues, /第 0040 项（已解决）/);
  assert.doesNotMatch(testIssues, /\bISSUE-\d{4,}\b/i);
  assert.doesNotMatch(testIssues, /问题现象|复现步骤|实际结果|预期结果|报错原文/);
});

test("silently replacing the root-owned charter with organization-side documentation fails", async () => {
  const baseline = await readBaseline();
  await withCharterFixture(async ({ fixtureCharterPath }) => {
    await fs.writeFile(
      fixtureCharterPath,
      "# AI品牌官组织侧新章程\n\n这是静默覆盖。\n",
      "utf8",
    );
    assert.equal(
      validateCharterBytes(await fs.readFile(fixtureCharterPath), baseline),
      false,
    );
  });
});

test("deleting, reordering, or rewriting every root-owned charter section fails", async (t) => {
  const baseline = await readBaseline();
  const original = await fs.readFile(CHARTER_PATH);
  const sections =
    baseline.rootOwnedOrganizationCharter.requiredRootOwnedSections;

  for (const section of sections) {
    await t.test(`${section.id}: delete`, async () => {
      const mutated = Buffer.concat([
        original.subarray(0, section.byteStart),
        original.subarray(section.byteEnd),
      ]);
      assert.equal(validateCharterBytes(mutated, baseline), false);
    });
    await t.test(`${section.id}: rewrite`, async () => {
      const mutated = Buffer.from(original);
      mutated[section.byteStart] =
        mutated[section.byteStart] === 0x23 ? 0x24 : 0x23;
      assert.equal(validateCharterBytes(mutated, baseline), false);
    });
    await t.test(`${section.id}: reorder`, async () => {
      const sectionBytes = original.subarray(
        section.byteStart,
        section.byteEnd,
      );
      const mutated = Buffer.concat([
        sectionBytes,
        original.subarray(0, section.byteStart),
        original.subarray(section.byteEnd),
      ]);
      assert.equal(validateCharterBytes(mutated, baseline), false);
    });
  }
});

test("a non-byte-exact original prefix fails even when required words remain", async () => {
  const baseline = await readBaseline();
  const original = await fs.readFile(CHARTER_PATH);
  const mutatedText = original
    .toString("utf8")
    .replace("解决品牌认知不足", "解决品牌认知不充分");
  assert.match(mutatedText, /品牌认知/);
  assert.equal(
    validateCharterBytes(Buffer.from(mutatedText, "utf8"), baseline),
    false,
  );
});

test("double markers, a missing END marker, or content outside the marked block fails", async (t) => {
  const baseline = await readBaseline();
  const original = await fs.readFile(CHARTER_PATH);
  const legalBody = `${BEGIN_MARKER}\n\n详情见 ORGANIZATION_DETAILS.md。\n\n${END_MARKER}`;
  const mutations = [
    ["double marker", `${legalBody}\n${BEGIN_MARKER}\n${END_MARKER}`],
    ["missing END", `${BEGIN_MARKER}\n\n详情见 ORGANIZATION_DETAILS.md。\n`],
    ["outside append", `${legalBody}\n标记外追加内容`],
  ];
  for (const [name, suffix] of mutations) {
    await t.test(name, () => {
      const mutated = Buffer.concat([
        original,
        Buffer.from(suffix, "utf8"),
      ]);
      assert.equal(validateCharterBytes(mutated, baseline), false);
    });
  }
});

test("the original bytes followed by one final legal details block passes", async () => {
  const baseline = await readBaseline();
  const original = await fs.readFile(CHARTER_PATH);
  const suffix =
    `${BEGIN_MARKER}\n\n` +
    "## 组织侧详细说明\n\n" +
    "组织侧流程、企业隔离、协作适配和能力成熟度详见 `ORGANIZATION_DETAILS.md`。" +
    "本区块不改变组织ID、默认主责、根注册状态或正式接单门槛。\n\n" +
    `${END_MARKER}\n`;
  const candidate = Buffer.concat([original, Buffer.from(suffix, "utf8")]);
  assert.equal(validateCharterBytes(candidate, baseline), true);
});

test("creating only ORGANIZATION_DETAILS.md while leaving the charter byte-exact passes", async () => {
  const baseline = await readBaseline();
  await withCharterFixture(
    async ({ fixtureCharterPath, fixtureDetailsPath }) => {
      const before = await fs.readFile(fixtureCharterPath);
      await fs.writeFile(
        fixtureDetailsPath,
        "# AI品牌官组织侧详细说明\n",
        "utf8",
      );
      const after = await fs.readFile(fixtureCharterPath);
      assert.deepEqual(after, before);
      assert.equal(validateCharterBytes(after, baseline), true);
      assert.notEqual((await fs.readFile(fixtureDetailsPath, "utf8")).trim(), "");
    },
  );
});

test("the real ORGANIZATION.md still equals the Task 1 byte baseline and DETAILS is separate", async () => {
  const baseline = await readBaseline();
  const current = await fs.readFile(CHARTER_PATH);
  const charter = baseline.rootOwnedOrganizationCharter;
  assert.equal(current.byteLength, charter.originalFileByteLength);
  assert.equal(sha256(current), charter.originalFileSha256);
  assert.equal(validateCharterBytes(current, baseline), true);
  assert.notEqual((await fs.readFile(DETAILS_PATH, "utf8")).trim(), "");
});
