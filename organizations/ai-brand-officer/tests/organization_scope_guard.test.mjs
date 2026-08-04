import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  canonicalJson,
  captureProtectedRootBaseline,
  checkProtectedRoot,
} from "../scripts/rebaseline_protected_root.mjs";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const ORGANIZATION_ROOT = path.resolve(TEST_DIR, "..");
const CONTROL_CENTER_ROOT = path.resolve(ORGANIZATION_ROOT, "..", "..");
const FIXED_CAPTURED_AT = "2026-07-28T00:00:00.000Z";
const BASELINE_RELATIVE_PATH = path.join(
  "temp",
  "implementation-baseline",
  "protected-root-files.json",
);
const execFileAsync = promisify(execFile);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function toNative(root, relativePath) {
  return path.join(root, ...relativePath.split("/"));
}

async function writeCanonicalJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, canonicalJson(value), "utf8");
}

async function snapshotRealProtectedRoot() {
  const baseline = await captureProtectedRootBaseline({
    controlCenterRoot: CONTROL_CENTER_ROOT,
    organizationRoot: ORGANIZATION_ROOT,
    capturedAt: FIXED_CAPTURED_AT,
  });
  return sha256(canonicalJson(baseline));
}

function collectLeafPaths(baseline) {
  const paths = new Set();
  for (const entry of baseline.protectedPaths) {
    if (!entry.exists) {
      continue;
    }
    if (Array.isArray(entry.recursiveFiles)) {
      for (const file of entry.recursiveFiles) {
        paths.add(file.path);
      }
    } else {
      paths.add(entry.path);
    }
  }
  return [...paths].sort((left, right) => left.localeCompare(right, "en"));
}

function collectPosterClosurePaths(baseline) {
  const closure = baseline.promotionalPosterDependencyClosure;
  const paths = new Set();
  for (const file of closure.recursiveFiles ?? closure.recursiveSkillFiles ?? []) {
    paths.add(file.path);
  }
  for (const file of closure.requiredExternalFiles) {
    paths.add(typeof file === "string" ? file : file.path);
  }
  return [...paths].sort((left, right) => left.localeCompare(right, "en"));
}

async function hashRealPosterClosure(paths) {
  const records = [];
  for (const relativePath of paths) {
    const bytes = await fs.readFile(toNative(CONTROL_CENTER_ROOT, relativePath));
    records.push(`${relativePath}|${bytes.length}|${sha256(bytes)}`);
  }
  return sha256(Buffer.from(records.join("\n"), "utf8"));
}

async function createFixtureFromRealRoot(baseline) {
  const fixtureRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "ai-brand-officer-scope-guard-"),
  );
  const fixtureOrganizationRoot = path.join(
    fixtureRoot,
    "organizations",
    "ai-brand-officer",
  );

  for (const entry of baseline.protectedPaths) {
    if (!entry.exists) {
      continue;
    }
    const source = toNative(CONTROL_CENTER_ROOT, entry.path);
    const destination = toNative(fixtureRoot, entry.path);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    if (Array.isArray(entry.recursiveFiles)) {
      await fs.cp(source, destination, { recursive: true });
    } else {
      await fs.copyFile(source, destination);
    }
  }

  await fs.mkdir(fixtureOrganizationRoot, { recursive: true });
  await fs.copyFile(
    path.join(ORGANIZATION_ROOT, "ORGANIZATION.md"),
    path.join(fixtureOrganizationRoot, "ORGANIZATION.md"),
  );
  await writeCanonicalJson(
    path.join(fixtureOrganizationRoot, BASELINE_RELATIVE_PATH),
    baseline,
  );

  return { fixtureRoot, fixtureOrganizationRoot };
}

function expectedCategory(relativePath, posterClosurePaths) {
  return posterClosurePaths.has(relativePath)
    ? "promotional-poster-dependency-closure"
    : "protected-root-path";
}

function assertRejected(result, category, relativePath) {
  assert.equal(result.ok, false, `mutation unexpectedly passed: ${relativePath}`);
  assert.ok(
    result.changes.some(
      (change) =>
        change.category === category &&
        (change.path === relativePath ||
          relativePath.startsWith(`${change.path}/`) ||
          change.path.startsWith(`${relativePath}/`)),
    ),
    `missing ${category} failure for ${relativePath}: ${JSON.stringify(result.changes)}`,
  );
}

async function runGuard(fixtureRoot, fixtureOrganizationRoot) {
  return checkProtectedRoot({
    controlCenterRoot: fixtureRoot,
    organizationRoot: fixtureOrganizationRoot,
  });
}

async function withRealClosureInvariant(closurePaths, action) {
  const before = await hashRealPosterClosure(closurePaths);
  await action();
  const after = await hashRealPosterClosure(closurePaths);
  assert.equal(after, before, "the real promotional-poster closure changed");
}

test("baseline records every protected path, recursive file, dependency, and charter byte range", async () => {
  const realBefore = await snapshotRealProtectedRoot();
  const baseline = await captureProtectedRootBaseline({
    controlCenterRoot: CONTROL_CENTER_ROOT,
    organizationRoot: ORGANIZATION_ROOT,
    capturedAt: FIXED_CAPTURED_AT,
  });

  assert.equal(baseline.schemaVersion, 1);
  assert.equal(baseline.capturedAt, FIXED_CAPTURED_AT);
  assert.equal(baseline.protectedPaths.length, 22);
  assert.deepEqual(
    baseline.protectedPaths.map((entry) => entry.path),
    [
      "package.json",
      "package-lock.json",
      "AGENTS.md",
      "control-center",
      "public-skills",
      "scripts/control-center",
      "scripts/feishu-commander",
      "config/feishu-commander-capabilities.json",
      "skills/creating-promotional-posters",
      "workflows/PROMOTIONAL_POSTER_PILOT.md",
      "shared/IMAGE_GENERATION_CHANNEL_STANDARD.md",
      "shared/PRODUCT_ASSET_FIDELITY_STANDARD.md",
      "templates/PROMOTIONAL_POSTER_JOB.json",
      "templates/PROMOTIONAL_POSTER_PROMPT_V1.md",
      "scripts/poster_workflow_gate.ps1",
      "shared/BROWSER_CONTINUOUS_ACTION_STANDARD.md",
      "scripts/browser_continuous_action_controller.mjs",
      "scripts/poster_chatgpt_browser_fastlane.mjs",
      "scripts/prepare_poster_asset_clipboard.ps1",
      "workflows/TAOBAO_ECOMMERCE_IMAGE_SET_PILOT.md",
      "shared/FEISHU_KNOWLEDGE_PREFLIGHT_STANDARD.md",
      "scripts/run_feishu_knowledge_preflight.mjs",
    ],
  );

  for (const entry of baseline.protectedPaths) {
    assert.equal(typeof entry.exists, "boolean");
    if (!entry.exists) {
      continue;
    }
    if (Array.isArray(entry.recursiveFiles)) {
      assert.deepEqual(
        entry.recursiveFiles.map((file) => file.path),
        [...entry.recursiveFiles]
          .map((file) => file.path)
          .sort((left, right) => left.localeCompare(right, "en")),
      );
      for (const file of entry.recursiveFiles) {
        assert.match(file.sha256, /^[a-f0-9]{64}$/);
        assert.ok(Number.isInteger(file.bytes));
      }
    } else {
      assert.match(entry.sha256, /^[a-f0-9]{64}$/);
      assert.ok(Number.isInteger(entry.bytes));
    }
  }

  const closure = baseline.promotionalPosterDependencyClosure;
  assert.equal(closure.root, "skills/creating-promotional-posters");
  assert.equal(closure.recursiveSkillDirectory, true);
  assert.equal(closure.requiredExternalFiles.length, 10);
  for (const entry of closure.requiredExternalFiles) {
    assert.equal(entry.type, "file");
    assert.equal(entry.exists, true);
    assert.ok(Number.isInteger(entry.bytes));
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
  }

  const charter = baseline.rootOwnedOrganizationCharter;
  assert.equal(charter.rangeMode, "startInclusive/endExclusive");
  assert.equal(charter.requiredRootOwnedSections.length, 4);
  assert.equal(charter.originalFileByteLength, charter.bytes);
  assert.equal(charter.originalFileSha256, charter.sha256);
  let previousEnd = -1;
  charter.requiredRootOwnedSections.forEach((section, index) => {
    assert.equal(section.order, index + 1);
    assert.ok(section.byteStart >= 0);
    assert.ok(section.byteEnd > section.byteStart);
    assert.equal(section.byteLength, section.byteEnd - section.byteStart);
    assert.ok(section.byteStart >= previousEnd, "charter ranges overlap");
    assert.match(section.sha256, /^[a-f0-9]{64}$/);
    previousEnd = section.byteEnd;
  });

  assert.equal(await snapshotRealProtectedRoot(), realBefore);
});

test("every protected file rejects byte changes, deletion, and rename while the real root remains unchanged", async () => {
  const realBefore = await snapshotRealProtectedRoot();
  const baseline = await captureProtectedRootBaseline({
    controlCenterRoot: CONTROL_CENTER_ROOT,
    organizationRoot: ORGANIZATION_ROOT,
    capturedAt: FIXED_CAPTURED_AT,
  });
  const closurePaths = collectPosterClosurePaths(baseline);
  const closurePathSet = new Set(closurePaths);
  const leafPaths = collectLeafPaths(baseline);
  const fixture = await createFixtureFromRealRoot(baseline);

  try {
    assert.equal((await runGuard(fixture.fixtureRoot, fixture.fixtureOrganizationRoot)).ok, true);
    for (const relativePath of leafPaths) {
      const targetPath = toNative(fixture.fixtureRoot, relativePath);
      const original = await fs.readFile(targetPath);
      const category = expectedCategory(relativePath, closurePathSet);

      await withRealClosureInvariant(closurePaths, async () => {
        const changed =
          original.length === 0
            ? Buffer.from("x")
            : Buffer.concat([
                Buffer.from([original[0] ^ 0xff]),
                original.subarray(1),
              ]);
        await fs.writeFile(targetPath, changed);
        try {
          assertRejected(
            await runGuard(fixture.fixtureRoot, fixture.fixtureOrganizationRoot),
            category,
            relativePath,
          );
        } finally {
          await fs.writeFile(targetPath, original);
        }
      });

      await withRealClosureInvariant(closurePaths, async () => {
        await fs.rm(targetPath);
        try {
          assertRejected(
            await runGuard(fixture.fixtureRoot, fixture.fixtureOrganizationRoot),
            category,
            relativePath,
          );
        } finally {
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.writeFile(targetPath, original);
        }
      });

      await withRealClosureInvariant(closurePaths, async () => {
        const renamedPath = `${targetPath}.renamed`;
        await fs.rename(targetPath, renamedPath);
        try {
          assertRejected(
            await runGuard(fixture.fixtureRoot, fixture.fixtureOrganizationRoot),
            category,
            relativePath,
          );
        } finally {
          await fs.rename(renamedPath, targetPath);
        }
      });
    }

    assert.equal((await runGuard(fixture.fixtureRoot, fixture.fixtureOrganizationRoot)).ok, true);
  } finally {
    await fs.rm(fixture.fixtureRoot, { recursive: true, force: true });
  }

  assert.equal(await snapshotRealProtectedRoot(), realBefore);
});

test("recursive Skill closure rejects an unregistered file and optional absent roots reject later appearance", async () => {
  const realBefore = await snapshotRealProtectedRoot();
  const baseline = await captureProtectedRootBaseline({
    controlCenterRoot: CONTROL_CENTER_ROOT,
    organizationRoot: ORGANIZATION_ROOT,
    capturedAt: FIXED_CAPTURED_AT,
  });
  const fixture = await createFixtureFromRealRoot(baseline);
  const addedSkillPath = toNative(
    fixture.fixtureRoot,
    "skills/creating-promotional-posters/references/UNREGISTERED.md",
  );

  try {
    await fs.writeFile(addedSkillPath, "unregistered\n", "utf8");
    assertRejected(
      await runGuard(fixture.fixtureRoot, fixture.fixtureOrganizationRoot),
      "promotional-poster-dependency-closure",
      "skills/creating-promotional-posters",
    );
    await fs.rm(addedSkillPath);

    const optionalPath = toNative(fixture.fixtureRoot, "package-lock.json");
    const optionalBytes = await fs.readFile(optionalPath);
    await fs.rm(optionalPath);
    const absentBaseline = await captureProtectedRootBaseline({
      controlCenterRoot: fixture.fixtureRoot,
      organizationRoot: fixture.fixtureOrganizationRoot,
      capturedAt: FIXED_CAPTURED_AT,
    });
    assert.equal(
      absentBaseline.protectedPaths.find((entry) => entry.path === "package-lock.json")
        .exists,
      false,
    );
    await writeCanonicalJson(
      path.join(fixture.fixtureOrganizationRoot, BASELINE_RELATIVE_PATH),
      absentBaseline,
    );
    await fs.writeFile(optionalPath, optionalBytes);
    assertRejected(
      await runGuard(fixture.fixtureRoot, fixture.fixtureOrganizationRoot),
      "protected-root-path",
      "package-lock.json",
    );
  } finally {
    await fs.rm(fixture.fixtureRoot, { recursive: true, force: true });
  }

  assert.equal(await snapshotRealProtectedRoot(), realBefore);
});

test("same-content external symlinks and directory junctions never satisfy protected paths", async () => {
  const baseline = await captureProtectedRootBaseline({
    controlCenterRoot: CONTROL_CENTER_ROOT,
    organizationRoot: ORGANIZATION_ROOT,
    capturedAt: FIXED_CAPTURED_AT,
  });
  const fixture = await createFixtureFromRealRoot(baseline);
  const externalRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "ai-brand-officer-external-link-target-"),
  );

  try {
    const packagePath = toNative(fixture.fixtureRoot, "package.json");
    const externalPackagePath = path.join(externalRoot, "package.json");
    await fs.copyFile(packagePath, externalPackagePath);
    await fs.rm(packagePath);
    await fs.symlink(externalPackagePath, packagePath, "file");
    assertRejected(
      await runGuard(fixture.fixtureRoot, fixture.fixtureOrganizationRoot),
      "protected-root-path",
      "package.json",
    );
    await fs.rm(packagePath);
    await fs.copyFile(externalPackagePath, packagePath);

    const skillPath = toNative(
      fixture.fixtureRoot,
      "skills/creating-promotional-posters",
    );
    const externalSkillPath = path.join(
      externalRoot,
      "creating-promotional-posters",
    );
    await fs.cp(skillPath, externalSkillPath, { recursive: true });
    await fs.rm(skillPath, { recursive: true, force: true });
    await fs.symlink(externalSkillPath, skillPath, "junction");
    assertRejected(
      await runGuard(fixture.fixtureRoot, fixture.fixtureOrganizationRoot),
      "promotional-poster-dependency-closure",
      "skills/creating-promotional-posters",
    );
    await fs.rm(skillPath, { force: true });
    await fs.cp(externalSkillPath, skillPath, { recursive: true });

    const charterPath = path.join(
      fixture.fixtureOrganizationRoot,
      "ORGANIZATION.md",
    );
    const externalCharterPath = path.join(externalRoot, "ORGANIZATION.md");
    await fs.copyFile(charterPath, externalCharterPath);
    await fs.rm(charterPath);
    await fs.symlink(externalCharterPath, charterPath, "file");
    assertRejected(
      await runGuard(fixture.fixtureRoot, fixture.fixtureOrganizationRoot),
      "root-owned-organization-charter",
      "organizations/ai-brand-officer/ORGANIZATION.md",
    );
    await fs.rm(charterPath);
    await fs.copyFile(externalCharterPath, charterPath);

    const baselinePath = path.join(
      fixture.fixtureOrganizationRoot,
      BASELINE_RELATIVE_PATH,
    );
    const externalBaselinePath = path.join(
      externalRoot,
      "protected-root-files.json",
    );
    await fs.copyFile(baselinePath, externalBaselinePath);
    await fs.rm(baselinePath);
    await fs.symlink(externalBaselinePath, baselinePath, "file");
    await assert.rejects(
      () => runGuard(fixture.fixtureRoot, fixture.fixtureOrganizationRoot),
      /symbolic link|junction|reparse|unsafe path/i,
    );
  } finally {
    await fs.rm(fixture.fixtureRoot, { recursive: true, force: true });
    await fs.rm(externalRoot, { recursive: true, force: true });
  }
});

function swapRanges(buffer, first, second) {
  const [left, right] =
    first.byteStart < second.byteStart ? [first, second] : [second, first];
  return Buffer.concat([
    buffer.subarray(0, left.byteStart),
    buffer.subarray(right.byteStart, right.byteEnd),
    buffer.subarray(left.byteEnd, right.byteStart),
    buffer.subarray(left.byteStart, left.byteEnd),
    buffer.subarray(right.byteEnd),
  ]);
}

test("all four root-owned charter ranges reject content changes, deletion, duplication, and reordering", async () => {
  const realBefore = await snapshotRealProtectedRoot();
  const baseline = await captureProtectedRootBaseline({
    controlCenterRoot: CONTROL_CENTER_ROOT,
    organizationRoot: ORGANIZATION_ROOT,
    capturedAt: FIXED_CAPTURED_AT,
  });
  const fixture = await createFixtureFromRealRoot(baseline);
  const charterPath = path.join(fixture.fixtureOrganizationRoot, "ORGANIZATION.md");
  const original = await fs.readFile(charterPath);
  const sections = baseline.rootOwnedOrganizationCharter.requiredRootOwnedSections;

  try {
    for (let index = 0; index < sections.length; index += 1) {
      const section = sections[index];
      const insertionPoint =
        section.byteEnd === original.length ? section.byteEnd - 1 : section.byteEnd;
      const changed = Buffer.concat([
        original.subarray(0, insertionPoint),
        Buffer.from("X", "utf8"),
        original.subarray(insertionPoint),
      ]);
      await fs.writeFile(charterPath, changed);
      assertRejected(
        await runGuard(fixture.fixtureRoot, fixture.fixtureOrganizationRoot),
        "root-owned-organization-charter",
        "organizations/ai-brand-officer/ORGANIZATION.md",
      );

      const deleted = Buffer.concat([
        original.subarray(0, section.byteStart),
        original.subarray(section.byteEnd),
      ]);
      await fs.writeFile(charterPath, deleted);
      assertRejected(
        await runGuard(fixture.fixtureRoot, fixture.fixtureOrganizationRoot),
        "root-owned-organization-charter",
        "organizations/ai-brand-officer/ORGANIZATION.md",
      );

      const duplicated = Buffer.concat([
        original.subarray(0, section.byteStart),
        original.subarray(section.byteStart, section.byteEnd),
        original.subarray(section.byteStart),
      ]);
      await fs.writeFile(charterPath, duplicated);
      assertRejected(
        await runGuard(fixture.fixtureRoot, fixture.fixtureOrganizationRoot),
        "root-owned-organization-charter",
        "organizations/ai-brand-officer/ORGANIZATION.md",
      );

      const other = sections[(index + 1) % sections.length];
      await fs.writeFile(charterPath, swapRanges(original, section, other));
      assertRejected(
        await runGuard(fixture.fixtureRoot, fixture.fixtureOrganizationRoot),
        "root-owned-organization-charter",
        "organizations/ai-brand-officer/ORGANIZATION.md",
      );
    }
  } finally {
    await fs.writeFile(charterPath, original);
    await fs.rm(fixture.fixtureRoot, { recursive: true, force: true });
  }

  assert.equal(await snapshotRealProtectedRoot(), realBefore);
});

test("unchanged charter and one legal end-marked append pass, but duplicate append blocks fail", async () => {
  const realBefore = await snapshotRealProtectedRoot();
  const baseline = await captureProtectedRootBaseline({
    controlCenterRoot: CONTROL_CENTER_ROOT,
    organizationRoot: ORGANIZATION_ROOT,
    capturedAt: FIXED_CAPTURED_AT,
  });
  const fixture = await createFixtureFromRealRoot(baseline);
  const charterPath = path.join(fixture.fixtureOrganizationRoot, "ORGANIZATION.md");
  const original = await fs.readFile(charterPath);
  const legalBlock = Buffer.from(
    [
      "<!-- BEGIN ORGANIZATION-SIDE DETAILS: ai-brand-officer -->",
      "组织侧只读细节。",
      "<!-- END ORGANIZATION-SIDE DETAILS: ai-brand-officer -->",
      "",
    ].join("\n"),
    "utf8",
  );

  try {
    assert.equal((await runGuard(fixture.fixtureRoot, fixture.fixtureOrganizationRoot)).ok, true);
    await fs.writeFile(charterPath, Buffer.concat([original, legalBlock]));
    assert.equal((await runGuard(fixture.fixtureRoot, fixture.fixtureOrganizationRoot)).ok, true);

    await fs.writeFile(
      charterPath,
      Buffer.concat([original, legalBlock, legalBlock]),
    );
    assertRejected(
      await runGuard(fixture.fixtureRoot, fixture.fixtureOrganizationRoot),
      "root-owned-organization-charter",
      "organizations/ai-brand-officer/ORGANIZATION.md",
    );

    const rootMarkerInsideLegalBlock = Buffer.from(
      [
        "<!-- BEGIN ORGANIZATION-SIDE DETAILS: ai-brand-officer -->",
        "## 公共能力与协作",
        "追加区不得复制任何根所有权标记。",
        "<!-- END ORGANIZATION-SIDE DETAILS: ai-brand-officer -->",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      charterPath,
      Buffer.concat([original, rootMarkerInsideLegalBlock]),
    );
    assertRejected(
      await runGuard(fixture.fixtureRoot, fixture.fixtureOrganizationRoot),
      "root-owned-organization-charter",
      "organizations/ai-brand-officer/ORGANIZATION.md",
    );

    await fs.writeFile(
      path.join(fixture.fixtureOrganizationRoot, "ORGANIZATION_DETAILS.md"),
      "allowed organization-side change\n",
      "utf8",
    );
    await fs.writeFile(charterPath, original);
    assert.equal((await runGuard(fixture.fixtureRoot, fixture.fixtureOrganizationRoot)).ok, true);
  } finally {
    await fs.rm(fixture.fixtureRoot, { recursive: true, force: true });
  }

  assert.equal(await snapshotRealProtectedRoot(), realBefore);
});

test("PowerShell 5.1 guard wrapper emits the required PASS and categorized FAIL messages", async () => {
  const baseline = await captureProtectedRootBaseline({
    controlCenterRoot: CONTROL_CENTER_ROOT,
    organizationRoot: ORGANIZATION_ROOT,
    capturedAt: FIXED_CAPTURED_AT,
  });
  const fixture = await createFixtureFromRealRoot(baseline);
  const wrapperPath = path.join(
    ORGANIZATION_ROOT,
    "scripts",
    "check_scope_guard.ps1",
  );
  const commonArguments = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    wrapperPath,
    "-ControlCenterRoot",
    fixture.fixtureRoot,
    "-OrganizationRoot",
    fixture.fixtureOrganizationRoot,
  ];

  try {
    const passed = await execFileAsync("powershell.exe", commonArguments, {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.match(passed.stdout, /PASS: protected root paths unchanged\./);
    await assert.rejects(
      () =>
        execFileAsync(
          "powershell.exe",
          [...commonArguments, "-BaselinePath", "attacker-baseline.json"],
          {
            encoding: "utf8",
            windowsHide: true,
          },
        ),
      (error) => {
        assert.equal(error.code, 1);
        const output = `${error.stdout}\n${error.stderr}`;
        assert.match(output, /BaselinePath/i);
        assert.doesNotMatch(output, /ROOT_CONTROL_CENTER_OWNED/);
        return true;
      },
    );

    const changedPath = toNative(
      fixture.fixtureRoot,
      "workflows/PROMOTIONAL_POSTER_PILOT.md",
    );
    const changedOriginal = await fs.readFile(changedPath);
    await fs.appendFile(changedPath, "changed\n", "utf8");
    await assert.rejects(
      () =>
        execFileAsync("powershell.exe", commonArguments, {
          encoding: "utf8",
          windowsHide: true,
        }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(
          `${error.stdout}\n${error.stderr}`,
          /FAIL: promotional poster dependency closure changed: workflows\/PROMOTIONAL_POSTER_PILOT\.md/,
        );
        return true;
      },
    );
    await fs.writeFile(changedPath, changedOriginal);

    const protectedPath = toNative(fixture.fixtureRoot, "package.json");
    const protectedOriginal = await fs.readFile(protectedPath);
    await fs.appendFile(protectedPath, "changed\n", "utf8");
    await assert.rejects(
      () =>
        execFileAsync("powershell.exe", commonArguments, {
          encoding: "utf8",
          windowsHide: true,
        }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(
          `${error.stdout}\n${error.stderr}`,
          /FAIL: protected root path changed: package\.json/,
        );
        return true;
      },
    );
    await fs.writeFile(protectedPath, protectedOriginal);

    const charterPath = path.join(
      fixture.fixtureOrganizationRoot,
      "ORGANIZATION.md",
    );
    await fs.appendFile(charterPath, "invalid append\n", "utf8");
    await assert.rejects(
      () =>
        execFileAsync("powershell.exe", commonArguments, {
          encoding: "utf8",
          windowsHide: true,
        }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(
          `${error.stdout}\n${error.stderr}`,
          /FAIL: root-owned organization charter changed:/,
        );
        return true;
      },
    );
  } finally {
    await fs.rm(fixture.fixtureRoot, { recursive: true, force: true });
  }
});
