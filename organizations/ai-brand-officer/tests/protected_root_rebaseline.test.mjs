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
  rebaselineProtectedRoot,
} from "../scripts/rebaseline_protected_root.mjs";

const execFileAsync = promisify(execFile);
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REAL_ORGANIZATION_ROOT = path.resolve(TEST_DIR, "..");
const SCRIPT_PATH = path.join(
  REAL_ORGANIZATION_ROOT,
  "scripts",
  "rebaseline_protected_root.mjs",
);
const BASELINE_RELATIVE_PATH = path.join(
  "temp",
  "implementation-baseline",
  "protected-root-files.json",
);
const HANDOFF_RELATIVE_DIRECTORY = path.join("temp", "root-change-handoffs");
const DENIAL_CODE = "ROOT_CONTROL_CENTER_OWNED";
const BASELINE_OVERRIDE_DENIAL_CODE = "BASELINE_OVERRIDE_FORBIDDEN";
const HANDOFF_INTEGRITY_ERROR = "HANDOFF_INTEGRITY_ERROR";
const FIXED_CAPTURED_AT = "2026-07-28T00:00:00.000Z";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function writeCanonicalJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, canonicalJson(value), "utf8");
}

async function createFixture() {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "ai-brand-officer-read-only-root-"),
  );
  const organizationRoot = path.join(root, "organizations", "ai-brand-officer");
  const baselinePath = path.join(organizationRoot, BASELINE_RELATIVE_PATH);
  const auditDirectory = path.join(
    organizationRoot,
    "decisions",
    "protected-root-rebaseline",
  );
  const transactionDirectory = path.join(
    organizationRoot,
    "temp",
    "implementation-baseline",
    ".protected-root-rebaseline.transaction",
  );
  const rootFile = path.join(root, "package.json");

  await fs.mkdir(organizationRoot, { recursive: true });
  await fs.writeFile(rootFile, '{"name":"fixture","private":true}\n', "utf8");
  await fs.copyFile(
    path.join(REAL_ORGANIZATION_ROOT, "ORGANIZATION.md"),
    path.join(organizationRoot, "ORGANIZATION.md"),
  );
  await fs.mkdir(auditDirectory, { recursive: true });
  await writeCanonicalJson(path.join(auditDirectory, "historical.json"), {
    historical: true,
    note: "preserved compatibility evidence",
  });

  const baseline = await captureProtectedRootBaseline({
    controlCenterRoot: root,
    organizationRoot,
    capturedAt: FIXED_CAPTURED_AT,
  });
  await writeCanonicalJson(baselinePath, baseline);

  return {
    root,
    organizationRoot,
    baselinePath,
    auditDirectory,
    transactionDirectory,
    rootFile,
    handoffDirectory: path.join(organizationRoot, HANDOFF_RELATIVE_DIRECTORY),
  };
}

async function snapshotPath(targetPath) {
  try {
    const stat = await fs.lstat(targetPath);
    if (stat.isSymbolicLink()) {
      return {
        type: "symbolic-link",
        target: await fs.readlink(targetPath),
      };
    }
    if (stat.isDirectory()) {
      const names = (await fs.readdir(targetPath)).sort((left, right) =>
        left.localeCompare(right, "en"),
      );
      const records = [];
      for (const name of names) {
        records.push([name, await snapshotPath(path.join(targetPath, name))]);
      }
      return { type: "directory", records };
    }
    return {
      type: "file",
      bytes: (await fs.readFile(targetPath)).toString("base64"),
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { type: "missing" };
    }
    throw error;
  }
}

async function immutableSnapshot(fixture) {
  return {
    baseline: await snapshotPath(fixture.baselinePath),
    audit: await snapshotPath(fixture.auditDirectory),
    rootFile: await snapshotPath(fixture.rootFile),
    transaction: await snapshotPath(fixture.transactionDirectory),
    handoff: await snapshotPath(fixture.handoffDirectory),
  };
}

async function assertApiDenied(...args) {
  await assert.rejects(
    () => rebaselineProtectedRoot(...args),
    (error) => {
      assert.equal(error.code, DENIAL_CODE);
      assert.equal(error.message, DENIAL_CODE);
      return true;
    },
  );
}

async function assertCliDenied(argumentsAfterScript) {
  await assert.rejects(
    () =>
      execFileAsync(process.execPath, [SCRIPT_PATH, ...argumentsAfterScript], {
        encoding: "utf8",
        windowsHide: true,
      }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(`${error.stdout}\n${error.stderr}`, new RegExp(DENIAL_CODE));
      return true;
    },
  );
}

test("direct API and every CLI rebaseline form deterministically reject, including legal-looking evidence", async () => {
  const fixture = await createFixture();
  try {
    const evidencePath = path.join(fixture.root, "root-task-evidence.json");
    await writeCanonicalJson(evidencePath, {
      schemaVersion: 1,
      sourceTaskRef: "ROOT-TASK-001",
      approvedBy: "main-window-0",
      approvedAt: "2026-07-28T08:00:00.000Z",
      reason: "legal-looking but organization-untrusted evidence",
      changedPaths: ["package.json"],
    });
    const before = await immutableSnapshot(fixture);

    await assertApiDenied();
    await assertApiDenied(null);
    await assertApiDenied({});
    await assertApiDenied({
      controlCenterRoot: fixture.root,
      organizationRoot: fixture.organizationRoot,
      sourceTaskRef: path.relative(fixture.root, evidencePath),
      approvedBy: "main-window-0",
      approvedAt: "2026-07-28T08:00:00.000Z",
      reason: "independent control-center root task",
      expectedOldBaselineHash: sha256(await fs.readFile(fixture.baselinePath)),
    });
    await assertCliDenied([]);
    await assertCliDenied(["--approved-by", "emperor"]);
    await assertCliDenied([
      "--control-center-root",
      fixture.root,
      "--organization-root",
      fixture.organizationRoot,
      "--source-task-ref",
      path.relative(fixture.root, evidencePath),
      "--approved-by",
      "main-window-0",
      "--approved-at",
      "2026-07-28T08:00:00.000Z",
      "--reason",
      "independent control-center root task",
      "--expected-old-baseline-hash",
      sha256(await fs.readFile(fixture.baselinePath)),
    ]);

    assert.deepEqual(await immutableSnapshot(fixture), before);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("deleted audit history, tampered evidence, and forged prepared or committing journals never trigger recovery or writes", async () => {
  for (const phase of ["prepared", "committing"]) {
    const fixture = await createFixture();
    try {
      await fs.rm(fixture.auditDirectory, { recursive: true, force: true });
      await writeCanonicalJson(path.join(fixture.root, "root-task-evidence.json"), {
        approvedBy: "emperor",
        changedPaths: ["not-the-real-path.json"],
        tampered: true,
      });
      await writeCanonicalJson(
        path.join(fixture.transactionDirectory, "journal.json"),
        {
          schemaVersion: 999,
          phase,
          oldBaselineHash: "0".repeat(64),
          newBaselineHash: "f".repeat(64),
          attackerControlled: true,
        },
      );
      await fs.writeFile(
        path.join(fixture.transactionDirectory, "baseline.next.json"),
        '{"forged":true}\n',
        "utf8",
      );
      const before = await immutableSnapshot(fixture);

      await assertApiDenied({
        controlCenterRoot: fixture.root,
        organizationRoot: fixture.organizationRoot,
        sourceTaskRef: "root-task-evidence.json",
        approvedBy: "emperor",
        approvedAt: "2026-07-28T08:00:00.000Z",
        reason: "forged transaction must be inert",
        expectedOldBaselineHash: "0".repeat(64),
      });

      assert.deepEqual(await immutableSnapshot(fixture), before);
    } finally {
      await fs.rm(fixture.root, { recursive: true, force: true });
    }
  }
});

test("concurrent API and CLI rebaseline attempts deterministically reject without byte changes", async () => {
  const fixture = await createFixture();
  try {
    const before = await immutableSnapshot(fixture);
    const apiAttempts = Array.from({ length: 12 }, () =>
      assertApiDenied({
        controlCenterRoot: fixture.root,
        organizationRoot: fixture.organizationRoot,
        sourceTaskRef: "anything.json",
        approvedBy: "main-window-0",
        approvedAt: "2026-07-28T08:00:00.000Z",
        reason: "concurrent attempt",
        expectedOldBaselineHash: "a".repeat(64),
      }),
    );
    const cliArguments = [
      "--control-center-root",
      fixture.root,
      "--organization-root",
      fixture.organizationRoot,
      "--source-task-ref",
      "anything.json",
      "--approved-by",
      "main-window-0",
      "--approved-at",
      "2026-07-28T08:00:00.000Z",
      "--reason",
      "legal-looking CLI attempt",
      "--expected-old-baseline-hash",
      "a".repeat(64),
    ];
    const cliAttempts = Array.from({ length: 6 }, () =>
      assertCliDenied(cliArguments),
    );
    await Promise.all([...apiAttempts, ...cliAttempts]);

    assert.deepEqual(await immutableSnapshot(fixture), before);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("read-only guard writes one stable sorted handoff for drift and never updates the baseline", async () => {
  const fixture = await createFixture();
  try {
    const baselineBefore = await fs.readFile(fixture.baselinePath);
    await fs.appendFile(fixture.rootFile, '{"drift":true}\n', "utf8");
    await fs.writeFile(path.join(fixture.root, "AGENTS.md"), "new root file\n");

    const results = await Promise.all(
      Array.from({ length: 24 }, () =>
        checkProtectedRoot({
          controlCenterRoot: fixture.root,
          organizationRoot: fixture.organizationRoot,
        }),
      ),
    );
    const [first, second] = results;

    assert.equal(first.ok, false);
    assert.equal(second.ok, false);
    assert.deepEqual(first.changedPaths, ["AGENTS.md", "package.json"]);
    assert.deepEqual(second.changedPaths, first.changedPaths);
    assert.equal(first.handoffId, second.handoffId);
    assert.equal(first.handoffPath, second.handoffPath);
    for (const result of results) {
      assert.equal(result.handoffId, first.handoffId);
      assert.equal(result.handoffPath, first.handoffPath);
    }

    const handoffNames = (
      await fs.readdir(fixture.handoffDirectory)
    ).filter((name) => name.endsWith(".json"));
    assert.equal(handoffNames.length, 1);
    assert.match(handoffNames[0], /^[a-f0-9]{64}\.json$/);

    const handoff = JSON.parse(
      await fs.readFile(first.handoffPath, "utf8"),
    );
    assert.deepEqual(Object.keys(handoff), [
      "schemaVersion",
      "organizationId",
      "detectedAt",
      "baselineHash",
      "changedPaths",
      "observedStateHash",
      "status",
      "requestedAction",
      "authorityBoundary",
      "evidenceRefs",
    ]);
    assert.equal(handoff.schemaVersion, 1);
    assert.equal(handoff.organizationId, "ai-brand-officer");
    assert.match(handoff.detectedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(handoff.baselineHash, sha256(baselineBefore));
    assert.deepEqual(handoff.changedPaths, ["AGENTS.md", "package.json"]);
    assert.match(handoff.observedStateHash, /^[a-f0-9]{64}$/);
    assert.equal(handoff.status, "awaiting-control-center-review");
    assert.equal(
      handoff.requestedAction,
      "control-center-review-protected-root-change",
    );
    assert.equal(handoff.authorityBoundary, "organization-read-only");
    assert.deepEqual(handoff.evidenceRefs, []);
    const finalStat = await fs.lstat(first.handoffPath);
    assert.equal(finalStat.isFile(), true);
    assert.equal(finalStat.isSymbolicLink(), false);
    assert.equal(finalStat.nlink, 1);
    assert.deepEqual(await fs.readFile(fixture.baselinePath), baselineBefore);
    assert.deepEqual(
      (await fs.readdir(fixture.handoffDirectory)).filter((name) =>
        name.includes(".tmp"),
      ),
      [],
    );

    const third = await checkProtectedRoot({
      controlCenterRoot: fixture.root,
      organizationRoot: fixture.organizationRoot,
    });
    assert.equal(third.handoffId, first.handoffId);
    assert.equal(
      (await fs.readdir(fixture.handoffDirectory)).filter((name) =>
        name.endsWith(".json"),
      ).length,
      1,
    );
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

async function prepareExistingHandoffTarget(fixture) {
  await fs.appendFile(fixture.rootFile, '{"drift":true}\n', "utf8");
  const validResult = await checkProtectedRoot({
    controlCenterRoot: fixture.root,
    organizationRoot: fixture.organizationRoot,
  });
  const validBytes = await fs.readFile(validResult.handoffPath);
  const validHandoff = JSON.parse(validBytes.toString("utf8"));
  await fs.rm(validResult.handoffPath);
  return { ...validResult, validBytes, validHandoff };
}

async function assertHandoffIntegrityDenied(fixture) {
  await assert.rejects(
    () =>
      checkProtectedRoot({
        controlCenterRoot: fixture.root,
        organizationRoot: fixture.organizationRoot,
      }),
    (error) => {
      assert.equal(error.code, HANDOFF_INTEGRITY_ERROR);
      assert.equal(error.message, HANDOFF_INTEGRITY_ERROR);
      return true;
    },
  );
}

test("poisoned JSON, duplicate-key JSON, wrong-schema JSON, and hard-linked final handoffs reject without overwrite", async () => {
  for (const scenario of [
    "poison-json",
    "duplicate-key",
    "wrong-schema",
    "hardlink",
  ]) {
    const fixture = await createFixture();
    try {
      const prepared = await prepareExistingHandoffTarget(fixture);
      let hardlinkSource = null;
      if (scenario === "poison-json") {
        await fs.writeFile(prepared.handoffPath, '{"truncated":', "utf8");
      } else if (scenario === "duplicate-key") {
        await fs.writeFile(
          prepared.handoffPath,
          prepared.validBytes
            .toString("utf8")
            .replace(
              '  "status": "awaiting-control-center-review",',
              [
                '  "status": "attacker-controlled",',
                '  "status": "awaiting-control-center-review",',
              ].join("\n"),
            ),
          "utf8",
        );
      } else if (scenario === "wrong-schema") {
        await fs.writeFile(
          prepared.handoffPath,
          `${JSON.stringify(
            {
              ...prepared.validHandoff,
              observedStateHash: "0".repeat(64),
              attackerControlled: true,
            },
            null,
            2,
          )}\n`,
          "utf8",
        );
      } else {
        hardlinkSource = path.join(
          fixture.organizationRoot,
          "temp",
          "hardlink-source.json",
        );
        await fs.writeFile(hardlinkSource, prepared.validBytes);
        await fs.link(hardlinkSource, prepared.handoffPath);
        assert.equal((await fs.lstat(prepared.handoffPath)).nlink, 2);
      }
      const before = await immutableSnapshot(fixture);

      await assertHandoffIntegrityDenied(fixture);

      assert.deepEqual(await immutableSnapshot(fixture), before);
      assert.deepEqual(
        (await fs.readdir(fixture.handoffDirectory)).filter((name) =>
          name.includes(".tmp"),
        ),
        [],
      );
      if (hardlinkSource) {
        assert.equal((await fs.lstat(prepared.handoffPath)).nlink, 2);
      }
    } finally {
      await fs.rm(fixture.root, { recursive: true, force: true });
    }
  }
});

test("symbolic-link final handoff rejects without following or overwrite when supported", async (context) => {
  const fixture = await createFixture();
  try {
    const prepared = await prepareExistingHandoffTarget(fixture);
    const symlinkTarget = path.join(
      fixture.organizationRoot,
      "temp",
      "symlink-target.json",
    );
    await fs.writeFile(symlinkTarget, prepared.validBytes);
    try {
      await fs.symlink(symlinkTarget, prepared.handoffPath, "file");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) {
        context.skip(`symbolic links unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    const before = await immutableSnapshot(fixture);

    await assertHandoffIntegrityDenied(fixture);

    assert.deepEqual(await immutableSnapshot(fixture), before);
    assert.equal((await fs.lstat(prepared.handoffPath)).isSymbolicLink(), true);
    assert.deepEqual(
      (await fs.readdir(fixture.handoffDirectory)).filter((name) =>
        name.includes(".tmp"),
      ),
      [],
    );
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("same changed path with A and B bytes gets distinct handoffs, while returning to A reuses its identity", async () => {
  const fixture = await createFixture();
  try {
    const original = await fs.readFile(fixture.rootFile);
    await fs.writeFile(
      fixture.rootFile,
      Buffer.concat([original, Buffer.from("state-A\n")]),
    );
    const stateA = await checkProtectedRoot({
      controlCenterRoot: fixture.root,
      organizationRoot: fixture.organizationRoot,
    });

    await fs.writeFile(
      fixture.rootFile,
      Buffer.concat([original, Buffer.from("state-B\n")]),
    );
    const stateB = await checkProtectedRoot({
      controlCenterRoot: fixture.root,
      organizationRoot: fixture.organizationRoot,
    });

    assert.notEqual(stateA.handoffId, stateB.handoffId);
    const handoffA = JSON.parse(await fs.readFile(stateA.handoffPath, "utf8"));
    const handoffB = JSON.parse(await fs.readFile(stateB.handoffPath, "utf8"));
    assert.notEqual(handoffA.observedStateHash, handoffB.observedStateHash);
    assert.deepEqual(handoffA.changedPaths, ["package.json"]);
    assert.deepEqual(handoffB.changedPaths, ["package.json"]);

    await fs.writeFile(
      fixture.rootFile,
      Buffer.concat([original, Buffer.from("state-A\n")]),
    );
    const stateAAgain = await checkProtectedRoot({
      controlCenterRoot: fixture.root,
      organizationRoot: fixture.organizationRoot,
    });
    assert.equal(stateAAgain.handoffId, stateA.handoffId);
    assert.equal(
      (await fs.readdir(fixture.handoffDirectory)).filter((name) =>
        name.endsWith(".json"),
      ).length,
      2,
    );
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("an unchanged root passes with zero writes and does not create a handoff directory", async () => {
  const fixture = await createFixture();
  try {
    const before = await immutableSnapshot(fixture);
    const result = await checkProtectedRoot({
      controlCenterRoot: fixture.root,
      organizationRoot: fixture.organizationRoot,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.changedPaths, []);
    assert.equal(result.handoffPath, null);
    assert.deepEqual(await immutableSnapshot(fixture), before);
    await assert.rejects(
      () => fs.access(fixture.handoffDirectory),
      (error) => error.code === "ENOENT",
    );
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("caller-supplied correct, forged, and current-drift baselines are rejected before any write", async () => {
  const fixture = await createFixture();
  try {
    const diskBaseline = JSON.parse(
      await fs.readFile(fixture.baselinePath, "utf8"),
    );
    const correctExternalBaseline = await captureProtectedRootBaseline({
      controlCenterRoot: fixture.root,
      organizationRoot: fixture.organizationRoot,
      capturedAt: FIXED_CAPTURED_AT,
    });
    const forgedExternalBaseline = {
      ...diskBaseline,
      schemaVersion: 999,
      attackerControlled: true,
    };
    await fs.appendFile(fixture.rootFile, '{"drift":true}\n', "utf8");
    const currentDriftBaseline = await captureProtectedRootBaseline({
      controlCenterRoot: fixture.root,
      organizationRoot: fixture.organizationRoot,
      capturedAt: "2026-07-28T01:00:00.000Z",
    });
    const before = await immutableSnapshot(fixture);

    for (const baseline of [
      correctExternalBaseline,
      forgedExternalBaseline,
      currentDriftBaseline,
    ]) {
      await assert.rejects(
        () =>
          checkProtectedRoot({
            controlCenterRoot: fixture.root,
            organizationRoot: fixture.organizationRoot,
            baseline,
          }),
        (error) => {
          assert.equal(error.code, BASELINE_OVERRIDE_DENIAL_CODE);
          assert.equal(error.message, BASELINE_OVERRIDE_DENIAL_CODE);
          return true;
        },
      );
    }

    assert.deepEqual(await immutableSnapshot(fixture), before);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("caller-supplied baseline paths are rejected by API and check CLI before any write", async () => {
  const fixture = await createFixture();
  try {
    const alternateBaselinePath = path.join(
      fixture.organizationRoot,
      "temp",
      "attacker-baseline.json",
    );
    await fs.copyFile(fixture.baselinePath, alternateBaselinePath);
    const before = await immutableSnapshot(fixture);

    await assert.rejects(
      () =>
        checkProtectedRoot({
          controlCenterRoot: fixture.root,
          organizationRoot: fixture.organizationRoot,
          baselinePath: alternateBaselinePath,
        }),
      (error) => {
        assert.equal(error.code, BASELINE_OVERRIDE_DENIAL_CODE);
        assert.equal(error.message, BASELINE_OVERRIDE_DENIAL_CODE);
        return true;
      },
    );
    await assertCliDenied([
      "--check",
      "--control-center-root",
      fixture.root,
      "--organization-root",
      fixture.organizationRoot,
      "--baseline-path",
      alternateBaselinePath,
    ]);

    assert.deepEqual(await immutableSnapshot(fixture), before);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});
