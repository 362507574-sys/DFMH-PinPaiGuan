import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROTECTED_PATHS = Object.freeze([
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
]);

export const PROMOTIONAL_POSTER_EXTERNAL_FILES = Object.freeze([
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
]);

const PROMOTIONAL_POSTER_SKILL_ROOT = "skills/creating-promotional-posters";
const CHARTER_RELATIVE_PATH =
  "organizations/ai-brand-officer/ORGANIZATION.md";
const BASELINE_RELATIVE_PATH = path.join(
  "temp",
  "implementation-baseline",
  "protected-root-files.json",
);
const APPEND_BEGIN =
  "<!-- BEGIN ORGANIZATION-SIDE DETAILS: ai-brand-officer -->";
const APPEND_END =
  "<!-- END ORGANIZATION-SIDE DETAILS: ai-brand-officer -->";
const APPROVED_BY = new Set(["emperor", "main-window-0"]);
const STRICT_UTC_RFC3339_PATTERN =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;
const ROOT_EVIDENCE_OWNERS = new Set([
  "emperor",
  "main-window-0",
  "control-center-root",
  "root-control-center",
]);
const ORGANIZATION_OWNER = "ai-brand-officer";

const CHARTER_SECTION_DEFINITIONS = Object.freeze([
  {
    id: "organization_id",
    startMarker: "- 组织 ID：`ai-brand-officer`",
    endMarker: "- 系统定位：品牌增长系统",
    order: 1,
  },
  {
    id: "registration_status",
    startMarker:
      "- 当前状态：`designing`，正在形成完整设计，尚未正式接单",
    endMarker: "## 负责结果",
    order: 2,
  },
  {
    id: "default_primary_organization",
    startMarker: "## 公共能力与协作",
    endMarker: "## 设计来源与正式接单门槛",
    order: 3,
  },
  {
    id: "formal_acceptance_threshold",
    startMarker: "## 设计来源与正式接单门槛",
    deterministicEnd: "originalFileByteLength",
    order: 4,
  },
]);

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const LOCK_DIRECTORY_NAME = ".protected-root-rebaseline.lock";
const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_LOCK_RETRY_MS = 25;
const DEFAULT_LOCK_STALE_MS = 300_000;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sortObjectRecursively(value) {
  if (Array.isArray(value)) {
    return value.map(sortObjectRecursively);
  }
  if (value && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortObjectRecursively(value[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(sortObjectRecursively(value), null, 2)}\n`;
}

function normalizeRelativePath(value) {
  return value.replaceAll("\\", "/");
}

function relativePathFrom(root, absolutePath) {
  return normalizeRelativePath(path.relative(root, absolutePath));
}

function comparePaths(left, right) {
  return left.localeCompare(right, "en");
}

function normalizedCasePath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function pathIsContained(allowedRoot, candidate) {
  const normalizedRoot = normalizedCasePath(allowedRoot);
  const normalizedCandidate = normalizedCasePath(candidate);
  const relative = path.relative(normalizedRoot, normalizedCandidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

async function assertSafeContainedPath({
  allowedRoot,
  targetPath,
  allowMissing = false,
  label = "path",
}) {
  const rootPath = path.resolve(allowedRoot);
  const candidatePath = path.resolve(targetPath);
  if (!pathIsContained(rootPath, candidatePath)) {
    throw new Error(`unsafe path escapes allowed root: ${label}`);
  }

  const rootLstat = await fs.lstat(rootPath);
  if (rootLstat.isSymbolicLink()) {
    throw new Error(`unsafe symbolic link, junction, or reparse root: ${label}`);
  }
  const realRoot = await fs.realpath(rootPath);
  const relative = path.relative(rootPath, candidatePath);
  const segments = relative === "" ? [] : relative.split(path.sep);
  let current = rootPath;

  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error.code === "ENOENT" && allowMissing) {
        return candidatePath;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(
        `unsafe symbolic link, junction, or reparse component: ${label}`,
      );
    }
    const realCurrent = await fs.realpath(current);
    if (!pathIsContained(realRoot, realCurrent)) {
      throw new Error(`unsafe realpath escapes allowed root: ${label}`);
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new Error(`unsafe non-directory path component: ${label}`);
    }
  }
  return candidatePath;
}

async function pathStat(targetPath) {
  try {
    return await fs.stat(targetPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function walkFiles(directoryPath, controlCenterRoot) {
  const output = [];

  async function visit(currentPath) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    entries.sort((left, right) => comparePaths(left.name, right.name));
    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      await assertSafeContainedPath({
        allowedRoot: controlCenterRoot,
        targetPath: absolutePath,
        label: relativePathFrom(controlCenterRoot, absolutePath),
      });
      const entryStat = await fs.lstat(absolutePath);
      if (entryStat.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entryStat.isFile()) {
        throw new Error(
          `unsupported protected path entry: ${relativePathFrom(
            controlCenterRoot,
            absolutePath,
          )}`,
        );
      }
      const bytes = await fs.readFile(absolutePath);
      output.push({
        path: relativePathFrom(controlCenterRoot, absolutePath),
        bytes: bytes.length,
        sha256: sha256(bytes),
      });
    }
  }

  await visit(directoryPath);
  output.sort((left, right) => comparePaths(left.path, right.path));
  return output;
}

async function capturePathEntry(controlCenterRoot, relativePath) {
  const absolutePath = path.join(
    controlCenterRoot,
    ...relativePath.split("/"),
  );
  await assertSafeContainedPath({
    allowedRoot: controlCenterRoot,
    targetPath: absolutePath,
    allowMissing: true,
    label: relativePath,
  });
  const stat = await pathStat(absolutePath);
  if (!stat) {
    return { path: relativePath, exists: false };
  }
  if (stat.isDirectory()) {
    return {
      path: relativePath,
      exists: true,
      type: "directory",
      recursiveFiles: await walkFiles(absolutePath, controlCenterRoot),
    };
  }
  if (!stat.isFile()) {
    throw new Error(`unsupported protected root path type: ${relativePath}`);
  }
  const bytes = await fs.readFile(absolutePath);
  return {
    path: relativePath,
    exists: true,
    type: "file",
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
}

function allBufferOccurrences(buffer, markerBuffer) {
  const offsets = [];
  let offset = 0;
  while (offset <= buffer.length - markerBuffer.length) {
    const found = buffer.indexOf(markerBuffer, offset);
    if (found < 0) {
      break;
    }
    offsets.push(found);
    offset = found + Math.max(markerBuffer.length, 1);
  }
  return offsets;
}

function uniqueMarkerOffset(buffer, marker, label) {
  const offsets = allBufferOccurrences(buffer, Buffer.from(marker, "utf8"));
  if (offsets.length !== 1) {
    throw new Error(
      `${label} marker must occur exactly once; found ${offsets.length}`,
    );
  }
  return offsets[0];
}

function captureCharterFromBytes(bytes) {
  const sections = [];
  let previousEnd = -1;

  for (const definition of CHARTER_SECTION_DEFINITIONS) {
    const byteStart = uniqueMarkerOffset(
      bytes,
      definition.startMarker,
      definition.id,
    );
    const byteEnd = definition.endMarker
      ? uniqueMarkerOffset(bytes, definition.endMarker, definition.id)
      : bytes.length;

    if (byteEnd <= byteStart) {
      throw new Error(`${definition.id} range is reversed or empty`);
    }
    if (byteStart < previousEnd) {
      throw new Error(`${definition.id} range overlaps or is out of order`);
    }

    const rangeBytes = bytes.subarray(byteStart, byteEnd);
    sections.push({
      ...definition,
      byteStart,
      byteEnd,
      byteLength: rangeBytes.length,
      sha256: sha256(rangeBytes),
    });
    previousEnd = byteEnd;
  }

  return {
    bytes: bytes.length,
    sha256: sha256(bytes),
    originalFileByteLength: bytes.length,
    originalFileSha256: sha256(bytes),
    originalPrefixMustRemainByteExact: true,
    rangeMode: "startInclusive/endExclusive",
    requiredRootOwnedSections: sections,
  };
}

async function captureRootOwnedCharter(organizationRoot) {
  const charterPath = path.join(organizationRoot, "ORGANIZATION.md");
  await assertSafeContainedPath({
    allowedRoot: organizationRoot,
    targetPath: charterPath,
    label: CHARTER_RELATIVE_PATH,
  });
  const bytes = await fs.readFile(charterPath);
  return {
    path: CHARTER_RELATIVE_PATH,
    ...captureCharterFromBytes(bytes),
  };
}

function cloneFileRecord(record) {
  return {
    path: record.path,
    type: "file",
    exists: true,
    bytes: record.bytes,
    sha256: record.sha256,
  };
}

export async function captureProtectedRootBaseline({
  controlCenterRoot,
  organizationRoot,
  capturedAt = new Date().toISOString(),
}) {
  if (!controlCenterRoot || !organizationRoot) {
    throw new Error("controlCenterRoot and organizationRoot are required");
  }
  await assertSafeContainedPath({
    allowedRoot: controlCenterRoot,
    targetPath: organizationRoot,
    label: "organizationRoot",
  });
  const parsedCapturedAt = Date.parse(capturedAt);
  if (!Number.isFinite(parsedCapturedAt)) {
    throw new Error("capturedAt must be a valid ISO-8601 timestamp");
  }

  const protectedPaths = [];
  for (const relativePath of PROTECTED_PATHS) {
    protectedPaths.push(
      await capturePathEntry(controlCenterRoot, relativePath),
    );
  }

  const skillEntry = protectedPaths.find(
    (entry) => entry.path === PROMOTIONAL_POSTER_SKILL_ROOT,
  );
  const externalEntries = PROMOTIONAL_POSTER_EXTERNAL_FILES.map(
    (relativePath) =>
      protectedPaths.find((entry) => entry.path === relativePath),
  );

  return {
    schemaVersion: 1,
    capturedAt: new Date(parsedCapturedAt).toISOString(),
    protectedPaths,
    promotionalPosterDependencyClosure: {
      root: PROMOTIONAL_POSTER_SKILL_ROOT,
      recursiveSkillDirectory: true,
      recursiveFiles: (skillEntry?.recursiveFiles ?? []).map(cloneFileRecord),
      requiredExternalFiles: externalEntries.map((entry, index) =>
        entry?.exists
          ? cloneFileRecord(entry)
          : {
              path: PROMOTIONAL_POSTER_EXTERNAL_FILES[index],
              type: "file",
              exists: false,
            },
      ),
      rejectContentChange: true,
      rejectDelete: true,
      rejectRenameOrMissing: true,
    },
    rootOwnedOrganizationCharter:
      await captureRootOwnedCharter(organizationRoot),
  };
}

function validateBaselineShape(baseline) {
  if (!baseline || baseline.schemaVersion !== 1) {
    throw new Error("protected root baseline schemaVersion must be 1");
  }
  if (!Array.isArray(baseline.protectedPaths)) {
    throw new Error("protected root baseline protectedPaths must be an array");
  }
  const expectedPaths = PROTECTED_PATHS;
  const actualPaths = baseline.protectedPaths.map((entry) => entry.path);
  if (
    actualPaths.length !== expectedPaths.length ||
    actualPaths.some((entry, index) => entry !== expectedPaths[index])
  ) {
    throw new Error("protected root baseline paths do not match Task 1");
  }
  const charter = baseline.rootOwnedOrganizationCharter;
  if (
    !charter ||
    charter.rangeMode !== "startInclusive/endExclusive" ||
    !Array.isArray(charter.requiredRootOwnedSections) ||
    charter.requiredRootOwnedSections.length !==
      CHARTER_SECTION_DEFINITIONS.length
  ) {
    throw new Error("root-owned charter baseline is incomplete");
  }
  let previousEnd = -1;
  charter.requiredRootOwnedSections.forEach((section, index) => {
    if (
      section.order !== index + 1 ||
      section.byteStart < previousEnd ||
      section.byteEnd <= section.byteStart ||
      section.byteLength !== section.byteEnd - section.byteStart
    ) {
      throw new Error("root-owned charter ranges overlap or are out of order");
    }
    previousEnd = section.byteEnd;
  });
}

async function readBaseline(organizationRoot, baselinePath) {
  const resolvedBaselinePath =
    baselinePath ?? path.join(organizationRoot, BASELINE_RELATIVE_PATH);
  const bytes = await fs.readFile(resolvedBaselinePath);
  const baseline = JSON.parse(bytes.toString("utf8"));
  validateBaselineShape(baseline);
  return { baseline, baselinePath: resolvedBaselinePath, bytes };
}

function closurePathSet(baseline) {
  const output = new Set();
  const closure = baseline.promotionalPosterDependencyClosure;
  output.add(closure.root);
  for (const entry of closure.recursiveFiles ?? []) {
    output.add(entry.path);
  }
  for (const entry of closure.requiredExternalFiles ?? []) {
    output.add(typeof entry === "string" ? entry : entry.path);
  }
  return output;
}

function isClosurePath(relativePath, paths) {
  for (const protectedPath of paths) {
    if (
      relativePath === protectedPath ||
      relativePath.startsWith(`${protectedPath}/`)
    ) {
      return true;
    }
  }
  return false;
}

function changeCategory(relativePath, closurePaths) {
  return isClosurePath(relativePath, closurePaths)
    ? "promotional-poster-dependency-closure"
    : "protected-root-path";
}

function addPathChange(changes, category, relativePath, reason) {
  changes.push({ category, path: relativePath, reason });
}

function compareFileRecords(
  expectedFiles,
  actualFiles,
  changes,
  closurePaths,
) {
  const expectedByPath = new Map(
    expectedFiles.map((entry) => [entry.path, entry]),
  );
  const actualByPath = new Map(actualFiles.map((entry) => [entry.path, entry]));
  const allPaths = [...new Set([...expectedByPath.keys(), ...actualByPath.keys()])].sort(
    comparePaths,
  );

  for (const relativePath of allPaths) {
    const expected = expectedByPath.get(relativePath);
    const actual = actualByPath.get(relativePath);
    const category = changeCategory(relativePath, closurePaths);
    if (!expected) {
      addPathChange(
        changes,
        category,
        relativePath,
        "unregistered recursive file appeared",
      );
      continue;
    }
    if (!actual) {
      addPathChange(
        changes,
        category,
        relativePath,
        "baseline recursive file is missing",
      );
      continue;
    }
    if (expected.bytes !== actual.bytes || expected.sha256 !== actual.sha256) {
      addPathChange(
        changes,
        category,
        relativePath,
        "protected file bytes or SHA-256 changed",
      );
    }
  }
}

async function compareProtectedPaths(
  controlCenterRoot,
  baseline,
  changes,
) {
  const closurePaths = closurePathSet(baseline);
  for (const expected of baseline.protectedPaths) {
    const actual = await capturePathEntry(controlCenterRoot, expected.path);
    const category = changeCategory(expected.path, closurePaths);
    if (expected.exists !== actual.exists) {
      addPathChange(
        changes,
        category,
        expected.path,
        expected.exists
          ? "baseline path is missing"
          : "previously absent protected path appeared",
      );
      continue;
    }
    if (!expected.exists) {
      continue;
    }
    if (expected.type !== actual.type) {
      addPathChange(
        changes,
        category,
        expected.path,
        "protected path type changed",
      );
      continue;
    }
    if (expected.type === "directory") {
      compareFileRecords(
        expected.recursiveFiles,
        actual.recursiveFiles,
        changes,
        closurePaths,
      );
      continue;
    }
    if (expected.bytes !== actual.bytes || expected.sha256 !== actual.sha256) {
      addPathChange(
        changes,
        category,
        expected.path,
        "protected file bytes or SHA-256 changed",
      );
    }
  }
}

function countTextOccurrences(text, marker) {
  let count = 0;
  let offset = 0;
  while (offset <= text.length - marker.length) {
    const index = text.indexOf(marker, offset);
    if (index < 0) {
      break;
    }
    count += 1;
    offset = index + marker.length;
  }
  return count;
}

function validateRootMarkersAcrossEntireCharter(bytes) {
  const markers = new Set();
  for (const definition of CHARTER_SECTION_DEFINITIONS) {
    markers.add(definition.startMarker);
    if (definition.endMarker) {
      markers.add(definition.endMarker);
    }
  }
  for (const marker of markers) {
    const occurrences = allBufferOccurrences(
      bytes,
      Buffer.from(marker, "utf8"),
    );
    if (occurrences.length !== 1) {
      throw new Error(
        `root-owned marker must occur exactly once across the complete charter: ${marker}`,
      );
    }
  }
}

function validateAppendSuffix(suffix) {
  const text = suffix.toString("utf8");
  if (
    countTextOccurrences(text, APPEND_BEGIN) !== 1 ||
    countTextOccurrences(text, APPEND_END) !== 1
  ) {
    return "organization-side append markers must each occur exactly once";
  }
  if (!text.startsWith(`${APPEND_BEGIN}\n`)) {
    return "organization-side append block must start at the original byte boundary";
  }
  const endOffset = text.indexOf(APPEND_END);
  if (endOffset <= APPEND_BEGIN.length) {
    return "organization-side append block markers are reversed or empty";
  }
  const trailing = text.slice(endOffset + APPEND_END.length);
  if (trailing !== "" && trailing !== "\n") {
    return "organization-side append block must be the final file content";
  }
  return null;
}

async function compareRootOwnedCharter(organizationRoot, baseline, changes) {
  const expected = baseline.rootOwnedOrganizationCharter;
  const charterPath = path.join(organizationRoot, "ORGANIZATION.md");
  let current;
  try {
    current = await fs.readFile(charterPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      addPathChange(
        changes,
        "root-owned-organization-charter",
        expected.path,
        "ORGANIZATION.md is missing",
      );
      return;
    }
    throw error;
  }

  try {
    validateRootMarkersAcrossEntireCharter(current);
  } catch (error) {
    addPathChange(
      changes,
      "root-owned-organization-charter",
      expected.path,
      error.message,
    );
    return;
  }

  if (current.length < expected.originalFileByteLength) {
    addPathChange(
      changes,
      "root-owned-organization-charter",
      expected.path,
      "original charter bytes were deleted",
    );
    return;
  }

  const originalPrefix = current.subarray(0, expected.originalFileByteLength);
  let currentSections;
  try {
    currentSections = captureCharterFromBytes(originalPrefix);
  } catch (error) {
    addPathChange(
      changes,
      "root-owned-organization-charter",
      expected.path,
      error.message,
    );
    return;
  }

  for (let index = 0; index < expected.requiredRootOwnedSections.length; index += 1) {
    const expectedSection = expected.requiredRootOwnedSections[index];
    const actualSection = currentSections.requiredRootOwnedSections[index];
    if (
      expectedSection.id !== actualSection.id ||
      expectedSection.order !== actualSection.order ||
      expectedSection.byteStart !== actualSection.byteStart ||
      expectedSection.byteEnd !== actualSection.byteEnd ||
      expectedSection.byteLength !== actualSection.byteLength ||
      expectedSection.sha256 !== actualSection.sha256
    ) {
      addPathChange(
        changes,
        "root-owned-organization-charter",
        expected.path,
        `root-owned range changed: ${expectedSection.id}`,
      );
      return;
    }
  }

  if (
    originalPrefix.length !== expected.originalFileByteLength ||
    sha256(originalPrefix) !== expected.originalFileSha256
  ) {
    addPathChange(
      changes,
      "root-owned-organization-charter",
      expected.path,
      "original charter prefix is not byte-exact",
    );
    return;
  }

  if (current.length === expected.originalFileByteLength) {
    return;
  }

  const appendError = validateAppendSuffix(
    current.subarray(expected.originalFileByteLength),
  );
  if (appendError) {
    addPathChange(
      changes,
      "root-owned-organization-charter",
      expected.path,
      appendError,
    );
  }
}

function normalizeChanges(changes) {
  const byIdentity = new Map();
  for (const change of changes) {
    const key = `${change.category}\0${change.path}\0${change.reason}`;
    byIdentity.set(key, change);
  }
  return [...byIdentity.values()].sort(
    (left, right) =>
      comparePaths(left.path, right.path) ||
      comparePaths(left.category, right.category) ||
      comparePaths(left.reason, right.reason),
  );
}

async function checkProtectedRootLegacy({
  controlCenterRoot,
  organizationRoot,
  baselinePath,
  baseline: suppliedBaseline,
}) {
  if (!controlCenterRoot || !organizationRoot) {
    throw new Error("controlCenterRoot and organizationRoot are required");
  }
  const baseline = suppliedBaseline
    ? suppliedBaseline
    : (await readBaseline(organizationRoot, baselinePath)).baseline;
  validateBaselineShape(baseline);

  const changes = [];
  await compareProtectedPaths(controlCenterRoot, baseline, changes);
  await compareRootOwnedCharter(organizationRoot, baseline, changes);
  const normalizedChanges = normalizeChanges(changes);
  return {
    ok: normalizedChanges.length === 0,
    changes: normalizedChanges,
    changedPaths: [
      ...new Set(normalizedChanges.map((change) => change.path)),
    ].sort(comparePaths),
  };
}

function formatGuardFailure(change) {
  if (change.category === "promotional-poster-dependency-closure") {
    return `FAIL: promotional poster dependency closure changed: ${change.path}`;
  }
  if (change.category === "root-owned-organization-charter") {
    return `FAIL: root-owned organization charter changed: ${change.reason}`;
  }
  return `FAIL: protected root path changed: ${change.path}`;
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

async function readEvidence(
  controlCenterRoot,
  sourceTaskRef,
  changelogText,
) {
  const normalizedRef = String(sourceTaskRef ?? "").trim();
  if (!normalizedRef) {
    throw new Error("sourceTaskRef is required");
  }
  const evidencePath = path.resolve(controlCenterRoot, normalizedRef);
  if (!isPathInside(controlCenterRoot, evidencePath)) {
    throw new Error("sourceTaskRef must resolve inside the control-center root");
  }
  let text;
  try {
    text = await fs.readFile(evidencePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      const stableReferencePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
      if (
        stableReferencePattern.test(normalizedRef) &&
        changelogText.includes(normalizedRef)
      ) {
        return {
          normalizedRef,
          evidencePath: path.join(controlCenterRoot, "CHANGELOG.md"),
          text: changelogText,
          structured: null,
        };
      }
      throw new Error(`sourceTaskRef evidence is missing: ${normalizedRef}`);
    }
    throw error;
  }
  if (!text.trim()) {
    throw new Error("sourceTaskRef evidence is empty");
  }
  let structured = null;
  try {
    structured = JSON.parse(text);
  } catch {
    // Plain-text authorization records are accepted when they carry all proof.
  }
  return { normalizedRef, evidencePath, text, structured };
}

function collectEvidenceOwners(structured) {
  if (!structured || typeof structured !== "object") {
    return [];
  }
  const ownerFields = [
    "implementedBy",
    "implementingOrganization",
    "organizationId",
    "owner",
    "taskOwner",
  ];
  return ownerFields
    .map((field) => structured[field])
    .filter((value) => typeof value === "string")
    .map((value) => value.trim().toLowerCase());
}

function validateIndependentRootEvidence({
  evidence,
  changelogText,
  changedPaths,
  approvedBy,
  reason,
}) {
  const evidenceOwners = collectEvidenceOwners(evidence.structured);
  if (evidenceOwners.includes(ORGANIZATION_OWNER)) {
    throw new Error(
      "rebaseline rejected: change was implemented by ai-brand-officer",
    );
  }

  const normalizedEvidenceText = evidence.text.toLowerCase();
  const organizationOwnershipPattern =
    /(?:implementedby|implementingorganization|organizationid|owner|taskowner)\s*["']?\s*[:=]\s*["']?ai-brand-officer/i;
  if (organizationOwnershipPattern.test(evidence.text)) {
    throw new Error(
      "rebaseline rejected: evidence identifies ai-brand-officer as implementer",
    );
  }

  const hasRootOwner =
    evidenceOwners.some((owner) => ROOT_EVIDENCE_OWNERS.has(owner)) ||
    [...ROOT_EVIDENCE_OWNERS].some((owner) =>
      normalizedEvidenceText.includes(owner),
    ) ||
    evidence.text.includes("主窗口0");
  if (!hasRootOwner) {
    throw new Error(
      "source evidence does not prove an independently authorized root task",
    );
  }

  const reasonCandidates = [];
  for (const field of ["taskRef", "sourceThreadId", "threadId"]) {
    const value = evidence.structured?.[field];
    if (typeof value === "string" && value.trim()) {
      reasonCandidates.push(value.trim());
    }
  }
  reasonCandidates.push(
    ...evidence.text
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("## "))
      .map((line) =>
        line.replace(/^##\s+(?:\d{4}-\d{2}-\d{2}｜)?/u, "").trim(),
      )
      .filter(Boolean),
  );
  reasonCandidates.push(
    ...(evidence.text.match(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu,
    ) ?? []),
  );
  if (/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(evidence.normalizedRef)) {
    reasonCandidates.push(evidence.normalizedRef);
  }
  const reasonEvidenceMatch = [...new Set(reasonCandidates)].find((candidate) =>
    reason.includes(candidate),
  );
  if (!reasonEvidenceMatch) {
    throw new Error(
      "reason must contain an exact source task, CHANGELOG title, or source thread reference",
    );
  }

  const evidenceChangedPaths = Array.isArray(evidence.structured?.changedPaths)
    ? [...new Set(evidence.structured.changedPaths)].sort(comparePaths)
    : null;
  let changelogBindingCoversUnlistedPaths = false;
  if (evidenceChangedPaths) {
    if (
      evidenceChangedPaths.length !== changedPaths.length ||
      evidenceChangedPaths.some(
        (relativePath, index) => relativePath !== changedPaths[index],
      )
    ) {
      throw new Error(
        "source evidence changedPaths do not match the complete guard diff",
      );
    }
  } else {
    const uncoveredPaths = [];
    for (const relativePath of changedPaths) {
      if (!evidence.text.includes(relativePath)) {
        uncoveredPaths.push(relativePath);
      }
    }
    if (uncoveredPaths.length > 0) {
      const changelogTitles = evidence.text
        .split(/\r?\n/u)
        .filter((line) => line.startsWith("## "))
        .map((line) => line.replace(/^##\s+(?:\d{4}-\d{2}-\d{2}｜)?/u, "").trim())
        .filter(Boolean);
      const sourceThreadPattern =
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
      const explicitChangelogBinding =
        path.basename(evidence.evidencePath).toLowerCase() === "changelog.md" &&
        approvedBy === "main-window-0" &&
        sourceThreadPattern.test(reason) &&
        changelogTitles.some((title) => reason.includes(title));
      changelogBindingCoversUnlistedPaths = explicitChangelogBinding;
      if (!explicitChangelogBinding) {
        throw new Error(
          `source evidence does not cover changed path: ${uncoveredPaths[0]}`,
        );
      }
    }
  }

  const evidenceTaskRef =
    typeof evidence.structured?.taskRef === "string"
      ? evidence.structured.taskRef
      : evidence.normalizedRef;
  const evidenceIsRootChangelog =
    path.basename(evidence.evidencePath).toLowerCase() === "changelog.md";
  if (
    !evidenceIsRootChangelog &&
    !changelogText.includes(evidence.normalizedRef) &&
    !changelogText.includes(evidenceTaskRef)
  ) {
    throw new Error("CHANGELOG.md does not reference the source task evidence");
  }
  for (const relativePath of changedPaths) {
    if (
      !changelogBindingCoversUnlistedPaths &&
      !changelogText.includes(relativePath)
    ) {
      throw new Error(
        `CHANGELOG.md does not cover changed path: ${relativePath}`,
      );
    }
  }
  return reasonEvidenceMatch;
}

function validateApproval({ approvedBy, approvedAt, reason }) {
  if (!APPROVED_BY.has(approvedBy)) {
    throw new Error("approvedBy must be emperor or main-window-0");
  }
  if (
    typeof approvedAt !== "string" ||
    !STRICT_UTC_RFC3339_PATTERN.test(approvedAt) ||
    !Number.isFinite(Date.parse(approvedAt)) ||
    new Date(approvedAt).toISOString() !== approvedAt
  ) {
    throw new Error(
      "approvedAt must be strict UTC RFC3339: YYYY-MM-DDTHH:mm:ss.sssZ",
    );
  }
  if (typeof reason !== "string" || !reason.trim()) {
    throw new Error("reason is required");
  }
}

async function writeNewFileAtomically(targetPath, bytes) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.tmp-${randomUUID()}`;
  await fs.writeFile(temporaryPath, bytes, { flag: "wx" });
  try {
    await fs.rename(temporaryPath, targetPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

async function replaceFileWithRollback(targetPath, bytes) {
  const token = randomUUID();
  const temporaryPath = `${targetPath}.tmp-${token}`;
  const backupPath = `${targetPath}.backup-${token}`;
  await fs.writeFile(temporaryPath, bytes, { flag: "wx" });
  await fs.rename(targetPath, backupPath);
  try {
    await fs.rename(temporaryPath, targetPath);
  } catch (error) {
    await fs.rename(backupPath, targetPath);
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
  return backupPath;
}

async function rollbackBaseline(targetPath, backupPath) {
  await fs.rm(targetPath, { force: true });
  await fs.rename(backupPath, targetPath);
}

function auditFilename(approvedAt) {
  return `${new Date(approvedAt)
    .toISOString()
    .replaceAll(":", "-")
    .replaceAll(".", "-")}.json`;
}

function boundedEnvironmentMilliseconds(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (
    !Number.isInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return parsed;
}

function lockTimings() {
  return {
    timeoutMs: boundedEnvironmentMilliseconds(
      "AI_BRAND_OFFICER_REBASELINE_LOCK_TIMEOUT_MS",
      DEFAULT_LOCK_TIMEOUT_MS,
      50,
      60_000,
    ),
    retryMs: boundedEnvironmentMilliseconds(
      "AI_BRAND_OFFICER_REBASELINE_LOCK_RETRY_MS",
      DEFAULT_LOCK_RETRY_MS,
      5,
      1_000,
    ),
    staleMs: boundedEnvironmentMilliseconds(
      "AI_BRAND_OFFICER_REBASELINE_LOCK_STALE_MS",
      DEFAULT_LOCK_STALE_MS,
      100,
      86_400_000,
    ),
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sameHostProcessIsAlive(owner) {
  if (
    !owner ||
    owner.hostname !== os.hostname() ||
    !Number.isInteger(owner.pid) ||
    owner.pid <= 0
  ) {
    return null;
  }
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") {
      return false;
    }
    return true;
  }
}

async function readLockOwner(lockPath) {
  try {
    return JSON.parse(
      await fs.readFile(path.join(lockPath, "owner.json"), "utf8"),
    );
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

async function reclaimLockIfSafelyStale(lockPath, staleMs) {
  let stat;
  try {
    stat = await fs.stat(lockPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return true;
    }
    throw error;
  }
  const owner = await readLockOwner(lockPath);
  const createdAtMilliseconds =
    typeof owner?.createdAt === "string" &&
    Number.isFinite(Date.parse(owner.createdAt))
      ? Date.parse(owner.createdAt)
      : stat.mtimeMs;
  if (Date.now() - createdAtMilliseconds <= staleMs) {
    return false;
  }

  // Safety rule: only reclaim a stale lock when it names this host and its PID
  // is conclusively dead. Unknown, remote, malformed, or active owners time out.
  if (sameHostProcessIsAlive(owner) !== false) {
    return false;
  }

  const quarantinePath = `${lockPath}.stale-${randomUUID()}`;
  try {
    await fs.rename(lockPath, quarantinePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return true;
    }
    if (error.code === "EEXIST" || error.code === "EPERM") {
      return false;
    }
    throw error;
  }
  await fs.rm(quarantinePath, { recursive: true, force: true });
  return true;
}

async function acquireRebaselineLock(baselinePath) {
  const lockPath = path.join(path.dirname(baselinePath), LOCK_DIRECTORY_NAME);
  const timings = lockTimings();
  const token = randomUUID();
  const owner = {
    owner: `protected-root-rebaseline:${os.hostname()}:${process.pid}`,
    createdAt: new Date().toISOString(),
    hostname: os.hostname(),
    pid: process.pid,
    token,
  };
  const startedAt = Date.now();

  while (true) {
    try {
      await fs.mkdir(lockPath);
      try {
        await fs.writeFile(
          path.join(lockPath, "owner.json"),
          canonicalJson(owner),
          { encoding: "utf8", flag: "wx" },
        );
      } catch (error) {
        await fs.rm(lockPath, { recursive: true, force: true });
        throw error;
      }
      return { lockPath, owner };
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }

    if (await reclaimLockIfSafelyStale(lockPath, timings.staleMs)) {
      continue;
    }
    if (Date.now() - startedAt >= timings.timeoutMs) {
      throw new Error(
        "timed out acquiring protected-root rebaseline lock",
      );
    }
    await delay(timings.retryMs);
  }
}

async function releaseRebaselineLock(lockHandle) {
  const currentOwner = await readLockOwner(lockHandle.lockPath);
  if (!currentOwner || currentOwner.token !== lockHandle.owner.token) {
    throw new Error(
      "protected-root rebaseline lock ownership changed before release",
    );
  }
  await fs.rm(lockHandle.lockPath, { recursive: true, force: false });
}

async function rebaselineProtectedRootLegacy({
  controlCenterRoot,
  organizationRoot,
  sourceTaskRef,
  approvedBy,
  approvedAt,
  reason,
  expectedOldBaselineHash,
}) {
  if (!controlCenterRoot || !organizationRoot) {
    throw new Error("controlCenterRoot and organizationRoot are required");
  }
  validateApproval({ approvedBy, approvedAt, reason });
  if (!/^[a-f0-9]{64}$/.test(expectedOldBaselineHash ?? "")) {
    throw new Error(
      "expectedOldBaselineHash must be a 64-character lowercase SHA-256",
    );
  }

  const baselinePath = path.join(organizationRoot, BASELINE_RELATIVE_PATH);
  const lockHandle = await acquireRebaselineLock(baselinePath);
  try {
    return await rebaselineProtectedRootUnderLock({
      controlCenterRoot,
      organizationRoot,
      sourceTaskRef,
      approvedBy,
      approvedAt,
      reason,
      expectedOldBaselineHash,
    });
  } finally {
    await releaseRebaselineLock(lockHandle);
  }
}

async function rebaselineProtectedRootUnderLock({
  controlCenterRoot,
  organizationRoot,
  sourceTaskRef,
  approvedBy,
  approvedAt,
  reason,
  expectedOldBaselineHash,
}) {
  if (!controlCenterRoot || !organizationRoot) {
    throw new Error("controlCenterRoot and organizationRoot are required");
  }
  validateApproval({ approvedBy, approvedAt, reason });
  if (!/^[a-f0-9]{64}$/.test(expectedOldBaselineHash ?? "")) {
    throw new Error(
      "expectedOldBaselineHash must be a 64-character lowercase SHA-256",
    );
  }

  const baselineRecord = await readBaseline(organizationRoot);
  const oldCanonicalBytes = Buffer.from(
    canonicalJson(baselineRecord.baseline),
    "utf8",
  );
  const oldBaselineHash = sha256(oldCanonicalBytes);
  if (oldBaselineHash !== expectedOldBaselineHash) {
    throw new Error("protected root baseline CAS conflict");
  }

  const stoppedGuard = await checkProtectedRoot({
    controlCenterRoot,
    organizationRoot,
    baseline: baselineRecord.baseline,
  });
  if (stoppedGuard.ok) {
    throw new Error(
      "rebaseline requires a stopped guard with a detected protected-root change",
    );
  }
  const changedPaths = [...stoppedGuard.changedPaths].sort(comparePaths);

  const changelogPath = path.join(controlCenterRoot, "CHANGELOG.md");
  let changelogText;
  try {
    changelogText = await fs.readFile(changelogPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("root CHANGELOG.md evidence is missing");
    }
    throw error;
  }
  const evidence = await readEvidence(
    controlCenterRoot,
    sourceTaskRef,
    changelogText,
  );
  const reasonEvidenceMatch = validateIndependentRootEvidence({
    evidence,
    changelogText,
    changedPaths,
    approvedBy,
    reason,
  });

  const newBaseline = await captureProtectedRootBaseline({
    controlCenterRoot,
    organizationRoot,
  });
  const newCanonicalBytes = Buffer.from(canonicalJson(newBaseline), "utf8");
  const newBaselineHash = sha256(newCanonicalBytes);
  const audit = {
    schemaVersion: 1,
    oldBaselineHash,
    newBaselineHash,
    changedPaths,
    sourceTaskRef: evidence.normalizedRef,
    approvedBy,
    approvedAt,
    reason: reason.trim(),
  };
  const auditBytes = Buffer.from(canonicalJson(audit), "utf8");

  const transactionRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "ai-brand-officer-protected-root-rebaseline-"),
  );
  const stagedBaselinePath = path.join(transactionRoot, "baseline.json");
  const stagedAuditPath = path.join(transactionRoot, "audit.json");
  const auditTargetPath = path.join(
    organizationRoot,
    "decisions",
    "protected-root-rebaseline",
    auditFilename(approvedAt),
  );
  let baselineBackupPath = null;
  let auditWritten = false;

  try {
    await fs.writeFile(stagedBaselinePath, newCanonicalBytes);
    await fs.writeFile(stagedAuditPath, auditBytes);
    const stagedBaseline = JSON.parse(
      (await fs.readFile(stagedBaselinePath)).toString("utf8"),
    );
    const stagedAudit = JSON.parse(
      (await fs.readFile(stagedAuditPath)).toString("utf8"),
    );
    validateBaselineShape(stagedBaseline);
    if (
      canonicalJson(stagedAudit) !== auditBytes.toString("utf8") ||
      sha256(Buffer.from(canonicalJson(stagedBaseline), "utf8")) !==
        newBaselineHash ||
      !stagedAudit.reason.includes(reasonEvidenceMatch)
    ) {
      throw new Error("staged rebaseline transaction failed validation");
    }
    const stagedGuard = await checkProtectedRoot({
      controlCenterRoot,
      organizationRoot,
      baseline: stagedBaseline,
    });
    if (!stagedGuard.ok) {
      throw new Error("new baseline does not validate the current protected root");
    }

    const currentBaselineRecord = await readBaseline(organizationRoot);
    const currentHash = sha256(
      Buffer.from(canonicalJson(currentBaselineRecord.baseline), "utf8"),
    );
    if (
      currentHash !== expectedOldBaselineHash ||
      currentHash !== oldBaselineHash
    ) {
      throw new Error("protected root baseline CAS conflict");
    }
    if (await pathStat(auditTargetPath)) {
      throw new Error("rebaseline audit record already exists");
    }

    await writeNewFileAtomically(auditTargetPath, auditBytes);
    auditWritten = true;
    baselineBackupPath = await replaceFileWithRollback(
      baselineRecord.baselinePath,
      newCanonicalBytes,
    );

    const finalGuard = await checkProtectedRoot({
      controlCenterRoot,
      organizationRoot,
    });
    if (!finalGuard.ok) {
      throw new Error("scope guard failed after rebaseline");
    }

    await fs.rm(baselineBackupPath, { force: true });
    baselineBackupPath = null;
    return {
      ok: true,
      oldBaselineHash,
      newBaselineHash,
      changedPaths,
      auditPath: auditTargetPath,
      reasonEvidenceMatch,
    };
  } catch (error) {
    if (baselineBackupPath) {
      await rollbackBaseline(baselineRecord.baselinePath, baselineBackupPath);
      baselineBackupPath = null;
    }
    if (auditWritten) {
      await fs.rm(auditTargetPath, { force: true });
    }
    throw error;
  } finally {
    await fs.rm(transactionRoot, { recursive: true, force: true });
  }
}

function parseCliArguments(argv) {
  const output = { check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      output.check = true;
      continue;
    }
    if (!argument.startsWith("--")) {
      throw new Error(`unexpected CLI argument: ${argument}`);
    }
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`missing value for --${key}`);
    }
    output[key] = value;
    index += 1;
  }
  return output;
}

async function runCliLegacy() {
  const args = parseCliArguments(process.argv.slice(2));
  const organizationRoot = path.resolve(
    args["organization-root"] ?? path.resolve(SCRIPT_DIR, ".."),
  );
  const controlCenterRoot = path.resolve(
    args["control-center-root"] ??
      path.resolve(organizationRoot, "..", ".."),
  );

  if (args.check) {
    const result = await checkProtectedRoot({
      controlCenterRoot,
      organizationRoot,
      baselinePath: args["baseline-path"]
        ? path.resolve(args["baseline-path"])
        : undefined,
    });
    if (!result.ok) {
      for (const change of result.changes) {
        console.error(formatGuardFailure(change));
      }
      process.exitCode = 1;
      return;
    }
    console.log("PASS: protected root paths unchanged.");
    return;
  }

  const result = await rebaselineProtectedRoot({
    controlCenterRoot,
    organizationRoot,
    sourceTaskRef: args["source-task-ref"],
    approvedBy: args["approved-by"],
    approvedAt: args["approved-at"],
    reason: args.reason,
    expectedOldBaselineHash: args["expected-old-baseline-hash"],
  });
  console.log(
    `PASS: protected root rebaseline completed. ChangedPaths=${result.changedPaths.length}.`,
  );
}

// The hardened implementation below supersedes the retained legacy reference
// implementation. Keeping the old code in-place makes the upgrade auditable
// while all exported and CLI entry points use the hardened path.

const HARDENED_LOCK_FILE_NAME = ".protected-root-rebaseline.lock";
const HARDENED_TRANSACTION_DIRECTORY_NAME =
  ".protected-root-rebaseline.transaction";
const AUDIT_RELATIVE_DIRECTORY = path.join(
  "decisions",
  "protected-root-rebaseline",
);
const HANDOFF_RELATIVE_DIRECTORY = path.join(
  "temp",
  "root-change-handoffs",
);
export const ROOT_CONTROL_CENTER_OWNED = "ROOT_CONTROL_CENTER_OWNED";
export const BASELINE_OVERRIDE_FORBIDDEN = "BASELINE_OVERRIDE_FORBIDDEN";
export const HANDOFF_INTEGRITY_ERROR = "HANDOFF_INTEGRITY_ERROR";
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUDIT_KEYS = Object.freeze([
  "approvedAt",
  "approvedBy",
  "changedPaths",
  "newBaselineHash",
  "oldBaselineHash",
  "reason",
  "schemaVersion",
  "sourceTaskRef",
]);
const EVIDENCE_REQUIRED_KEYS = Object.freeze([
  "approvedAt",
  "approvedBy",
  "changedPaths",
  "reason",
  "schemaVersion",
  "sourceTaskId",
  "sourceThreadId",
  "title",
]);

function isStrictApprovedAt(value) {
  return (
    typeof value === "string" &&
    STRICT_UTC_RFC3339_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function arraysEqual(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sortedUniqueStringPaths(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error(`${label} must be a non-empty array`);
  }
  if (
    value.some(
      (entry) =>
        typeof entry !== "string" ||
        !entry ||
        path.isAbsolute(entry) ||
        entry.includes("\\") ||
        entry.split("/").some((segment) => segment === ".." || segment === ""),
    )
  ) {
    throw new Error(`${label} contains an unsafe or invalid path`);
  }
  const sorted = [...value].sort(comparePaths);
  if (!arraysEqual(value, sorted) || new Set(value).size !== value.length) {
    throw new Error(`${label} must be sorted and unique`);
  }
  return sorted;
}

async function hardenedReadBaseline(organizationRoot, baselinePath) {
  const resolvedBaselinePath = path.resolve(
    baselinePath ?? path.join(organizationRoot, BASELINE_RELATIVE_PATH),
  );
  await assertSafeContainedPath({
    allowedRoot: organizationRoot,
    targetPath: resolvedBaselinePath,
    label: "protected root baseline",
  });
  const bytes = await fs.readFile(resolvedBaselinePath);
  let baseline;
  try {
    baseline = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("protected root baseline is not valid JSON");
  }
  validateBaselineShape(baseline);
  if (bytes.toString("utf8") !== canonicalJson(baseline)) {
    throw new Error("protected root baseline must be canonical JSON");
  }
  return {
    baseline,
    baselinePath: resolvedBaselinePath,
    bytes,
    hash: sha256(Buffer.from(canonicalJson(baseline), "utf8")),
  };
}

async function hardenedCompareProtectedPaths(
  controlCenterRoot,
  baseline,
  changes,
) {
  const closurePaths = closurePathSet(baseline);
  for (const expected of baseline.protectedPaths) {
    const category = changeCategory(expected.path, closurePaths);
    let actual;
    try {
      actual = await capturePathEntry(controlCenterRoot, expected.path);
    } catch (error) {
      addPathChange(changes, category, expected.path, error.message);
      continue;
    }
    if (expected.exists !== actual.exists) {
      addPathChange(
        changes,
        category,
        expected.path,
        expected.exists
          ? "baseline path is missing"
          : "previously absent protected path appeared",
      );
      continue;
    }
    if (!expected.exists) {
      continue;
    }
    if (expected.type !== actual.type) {
      addPathChange(
        changes,
        category,
        expected.path,
        "protected path type changed",
      );
      continue;
    }
    if (expected.type === "directory") {
      compareFileRecords(
        expected.recursiveFiles,
        actual.recursiveFiles,
        changes,
        closurePaths,
      );
      continue;
    }
    if (expected.bytes !== actual.bytes || expected.sha256 !== actual.sha256) {
      addPathChange(
        changes,
        category,
        expected.path,
        "protected file bytes or SHA-256 changed",
      );
    }
  }
}

async function hardenedCompareCharter(organizationRoot, baseline, changes) {
  const expectedPath = baseline.rootOwnedOrganizationCharter.path;
  try {
    await assertSafeContainedPath({
      allowedRoot: organizationRoot,
      targetPath: path.join(organizationRoot, "ORGANIZATION.md"),
      label: expectedPath,
    });
    await compareRootOwnedCharter(organizationRoot, baseline, changes);
  } catch (error) {
    addPathChange(
      changes,
      "root-owned-organization-charter",
      expectedPath,
      error.message,
    );
  }
}

function validateAuditRecord(audit, filename) {
  if (
    !audit ||
    typeof audit !== "object" ||
    Array.isArray(audit) ||
    !arraysEqual(Object.keys(audit).sort(comparePaths), AUDIT_KEYS)
  ) {
    throw new Error("audit record has unexpected or missing fields");
  }
  if (
    audit.schemaVersion !== 1 ||
    !HASH_PATTERN.test(audit.oldBaselineHash ?? "") ||
    !HASH_PATTERN.test(audit.newBaselineHash ?? "") ||
    !APPROVED_BY.has(audit.approvedBy) ||
    !isStrictApprovedAt(audit.approvedAt) ||
    typeof audit.reason !== "string" ||
    !audit.reason.trim() ||
    typeof audit.sourceTaskRef !== "string" ||
    !audit.sourceTaskRef.trim()
  ) {
    throw new Error("audit record contains invalid field values");
  }
  sortedUniqueStringPaths(audit.changedPaths, "audit changedPaths");
  if (filename !== auditFilename(audit.approvedAt)) {
    throw new Error("audit filename does not match approvedAt");
  }
}

async function validateAuditSourceReference(controlCenterRoot, sourceTaskRef) {
  const normalizedRef = normalizeRelativePath(sourceTaskRef.trim());
  if (
    path.isAbsolute(normalizedRef) ||
    normalizedRef.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw new Error("audit sourceTaskRef is unsafe");
  }
  const sourcePath = path.resolve(controlCenterRoot, normalizedRef);
  await assertSafeContainedPath({
    allowedRoot: controlCenterRoot,
    targetPath: sourcePath,
    label: `audit sourceTaskRef ${normalizedRef}`,
  });
  const stat = await fs.lstat(sourcePath);
  if (!stat.isFile()) {
    throw new Error("audit sourceTaskRef must be a regular file");
  }
}

async function validateAuditChain({
  controlCenterRoot,
  organizationRoot,
  baseline,
}) {
  const auditRoot = path.join(organizationRoot, AUDIT_RELATIVE_DIRECTORY);
  await assertSafeContainedPath({
    allowedRoot: organizationRoot,
    targetPath: auditRoot,
    allowMissing: true,
    label: "protected root audit directory",
  });
  let entries;
  try {
    entries = await fs.readdir(auditRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  entries.sort((left, right) => comparePaths(left.name, right.name));
  const records = [];
  for (const entry of entries) {
    const auditPath = path.join(auditRoot, entry.name);
    await assertSafeContainedPath({
      allowedRoot: organizationRoot,
      targetPath: auditPath,
      label: `audit entry ${entry.name}`,
    });
    const stat = await fs.lstat(auditPath);
    if (!entry.name.endsWith(".json") || !stat.isFile()) {
      throw new Error(`unexpected audit directory entry: ${entry.name}`);
    }
    const bytes = await fs.readFile(auditPath);
    let audit;
    try {
      audit = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new Error(`malformed audit JSON: ${entry.name}`);
    }
    if (bytes.toString("utf8") !== canonicalJson(audit)) {
      throw new Error(`audit record is not canonical JSON: ${entry.name}`);
    }
    validateAuditRecord(audit, entry.name);
    await validateAuditSourceReference(controlCenterRoot, audit.sourceTaskRef);
    records.push({ filename: entry.name, audit });
  }

  records.sort(
    (left, right) =>
      comparePaths(left.audit.approvedAt, right.audit.approvedAt) ||
      comparePaths(left.filename, right.filename),
  );
  const seenTimes = new Set();
  const seenTransitions = new Set();
  for (let index = 0; index < records.length; index += 1) {
    const { audit } = records[index];
    const transition = `${audit.oldBaselineHash}:${audit.newBaselineHash}`;
    if (seenTimes.has(audit.approvedAt) || seenTransitions.has(transition)) {
      throw new Error("duplicate audit transition or approval time");
    }
    seenTimes.add(audit.approvedAt);
    seenTransitions.add(transition);
    if (
      index > 0 &&
      audit.oldBaselineHash !== records[index - 1].audit.newBaselineHash
    ) {
      throw new Error("audit hash chain is forked or discontinuous");
    }
  }
  if (records.length > 0) {
    const baselineHash = sha256(
      Buffer.from(canonicalJson(baseline), "utf8"),
    );
    if (records.at(-1).audit.newBaselineHash !== baselineHash) {
      throw new Error("audit chain final hash does not match the baseline");
    }
  }
  return records;
}

async function hardenedCheckCore({
  controlCenterRoot,
  organizationRoot,
  baseline,
  validateAudits = true,
}) {
  validateBaselineShape(baseline);
  const changes = [];
  await hardenedCompareProtectedPaths(controlCenterRoot, baseline, changes);
  await hardenedCompareCharter(organizationRoot, baseline, changes);
  if (validateAudits) {
    try {
      await validateAuditChain({
        controlCenterRoot,
        organizationRoot,
        baseline,
      });
    } catch (error) {
      addPathChange(
        changes,
        "protected-root-audit-chain",
        normalizeRelativePath(AUDIT_RELATIVE_DIRECTORY),
        error.message,
      );
    }
  }
  const normalizedChanges = normalizeChanges(changes);
  return {
    ok: normalizedChanges.length === 0,
    changes: normalizedChanges,
    changedPaths: [
      ...new Set(normalizedChanges.map((change) => change.path)),
    ].sort(comparePaths),
  };
}

async function syncDirectoryBestEffort(directoryPath) {
  let handle;
  try {
    handle = await fs.open(directoryPath, "r");
    await handle.sync();
  } catch (error) {
    if (!["EISDIR", "EINVAL", "EPERM", "EACCES"].includes(error.code)) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

async function durableWriteNew(targetPath, bytes) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const handle = await fs.open(targetPath, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectoryBestEffort(path.dirname(targetPath));
}

async function durableReplace(targetPath, bytes) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.tmp-${randomUUID()}`;
  await durableWriteNew(temporaryPath, bytes);
  try {
    await fs.rename(temporaryPath, targetPath);
  } catch (error) {
    if (process.platform === "win32" && ["EEXIST", "EPERM"].includes(error.code)) {
      await fs.rm(targetPath, { force: true });
      await fs.rename(temporaryPath, targetPath);
    } else {
      await fs.rm(temporaryPath, { force: true });
      throw error;
    }
  }
  await syncDirectoryBestEffort(path.dirname(targetPath));
}

async function hardenedReadLockOwner(lockPath) {
  try {
    const bytes = await fs.readFile(lockPath);
    const owner = JSON.parse(bytes.toString("utf8"));
    if (
      !owner ||
      typeof owner !== "object" ||
      typeof owner.token !== "string" ||
      typeof owner.hostname !== "string" ||
      !Number.isInteger(owner.pid) ||
      typeof owner.createdAt !== "string"
    ) {
      return null;
    }
    return owner;
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

async function hardenedReclaimStaleLock(
  lockPath,
  staleMs,
  preserveMalformed,
) {
  let stat;
  try {
    stat = await fs.lstat(lockPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return true;
    }
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return false;
  }
  const owner = await hardenedReadLockOwner(lockPath);
  if (!owner && preserveMalformed) {
    return false;
  }
  const createdAtMs =
    owner && Number.isFinite(Date.parse(owner.createdAt))
      ? Date.parse(owner.createdAt)
      : stat.mtimeMs;
  if (Date.now() - createdAtMs <= staleMs) {
    return false;
  }
  if (owner) {
    if (owner.hostname !== os.hostname()) {
      return false;
    }
    if (sameHostProcessIsAlive(owner) !== false) {
      return false;
    }
  }
  const quarantinePath = `${lockPath}.stale-${randomUUID()}`;
  try {
    await fs.rename(lockPath, quarantinePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return true;
    }
    if (["EEXIST", "EPERM", "EACCES"].includes(error.code)) {
      return false;
    }
    throw error;
  }
  await fs.rm(quarantinePath, { force: true });
  await syncDirectoryBestEffort(path.dirname(lockPath));
  return true;
}

async function hardenedAcquireLock(baselinePath) {
  const directoryPath = path.dirname(baselinePath);
  const lockPath = path.join(directoryPath, HARDENED_LOCK_FILE_NAME);
  await assertSafeContainedPath({
    allowedRoot: directoryPath,
    targetPath: lockPath,
    allowMissing: true,
    label: "protected root lock",
  });
  const timings = lockTimings();
  const owner = {
    owner: `protected-root-rebaseline:${os.hostname()}:${process.pid}`,
    createdAt: new Date().toISOString(),
    hostname: os.hostname(),
    pid: process.pid,
    token: randomUUID(),
  };
  const ownerTemporaryPath = path.join(
    directoryPath,
    `.protected-root-rebaseline.owner-${owner.token}.tmp`,
  );
  const startedAt = Date.now();
  let preserveMalformed = false;
  try {
    const initialStat = await fs.lstat(lockPath);
    const initialOwner = await hardenedReadLockOwner(lockPath);
    preserveMalformed =
      initialStat.isFile() &&
      !initialOwner &&
      Date.now() - initialStat.mtimeMs <= timings.staleMs;
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  while (true) {
    await durableWriteNew(
      ownerTemporaryPath,
      Buffer.from(canonicalJson(owner), "utf8"),
    );
    try {
      await fs.link(ownerTemporaryPath, lockPath);
      await syncDirectoryBestEffort(directoryPath);
      await fs.rm(ownerTemporaryPath, { force: true });
      return { lockPath, owner };
    } catch (error) {
      await fs.rm(ownerTemporaryPath, { force: true });
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
    if (
      await hardenedReclaimStaleLock(
        lockPath,
        timings.staleMs,
        preserveMalformed,
      )
    ) {
      continue;
    }
    if (Date.now() - startedAt >= timings.timeoutMs) {
      throw new Error("timed out acquiring protected-root rebaseline lock");
    }
    await delay(timings.retryMs);
  }
}

async function hardenedReleaseLock(handle) {
  const current = await hardenedReadLockOwner(handle.lockPath);
  if (!current || current.token !== handle.owner.token) {
    throw new Error("protected-root rebaseline lock ownership changed");
  }
  await fs.rm(handle.lockPath, { force: false });
  await syncDirectoryBestEffort(path.dirname(handle.lockPath));
}

function transactionPaths(baselinePath) {
  const root = path.join(
    path.dirname(baselinePath),
    HARDENED_TRANSACTION_DIRECTORY_NAME,
  );
  return {
    root,
    journal: path.join(root, "journal.json"),
    oldBaseline: path.join(root, "baseline.old.json"),
    newBaseline: path.join(root, "baseline.new.json"),
    newAudit: path.join(root, "audit.new.json"),
    displacedBaseline: path.join(root, "baseline.displaced.json"),
  };
}

async function writeTransactionJournal(paths, journal) {
  await durableReplace(
    paths.journal,
    Buffer.from(canonicalJson(journal), "utf8"),
  );
}

function crashAfterPhase(phase) {
  if (process.env.AI_BRAND_OFFICER_REBASELINE_CRASH_AFTER_PHASE === phase) {
    process.exit(91);
  }
}

async function readCanonicalJsonFile(targetPath, label) {
  const bytes = await fs.readFile(targetPath);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  if (bytes.toString("utf8") !== canonicalJson(value)) {
    throw new Error(`${label} is not canonical JSON`);
  }
  return { bytes, value };
}

async function hardenedRecoverTransaction({
  controlCenterRoot,
  organizationRoot,
  baselinePath,
}) {
  const paths = transactionPaths(baselinePath);
  await assertSafeContainedPath({
    allowedRoot: path.dirname(baselinePath),
    targetPath: paths.root,
    allowMissing: true,
    label: "protected root transaction",
  });
  try {
    await fs.access(paths.root);
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
  for (const targetPath of [
    paths.journal,
    paths.oldBaseline,
    paths.newBaseline,
    paths.newAudit,
  ]) {
    await assertSafeContainedPath({
      allowedRoot: paths.root,
      targetPath,
      label: "protected root transaction artifact",
    });
  }
  const journalRecord = await readCanonicalJsonFile(
    paths.journal,
    "transaction journal",
  );
  const oldRecord = await readCanonicalJsonFile(
    paths.oldBaseline,
    "transaction old baseline",
  );
  const newRecord = await readCanonicalJsonFile(
    paths.newBaseline,
    "transaction new baseline",
  );
  const auditRecord = await readCanonicalJsonFile(
    paths.newAudit,
    "transaction audit",
  );
  validateBaselineShape(oldRecord.value);
  validateBaselineShape(newRecord.value);
  const journal = journalRecord.value;
  if (
    journal?.schemaVersion !== 1 ||
    ![
      "prepared",
      "audit_written",
      "baseline_displaced",
      "baseline_written",
      "committed",
    ].includes(journal.phase) ||
    sha256(oldRecord.bytes) !== journal.oldBaselineHash ||
    sha256(newRecord.bytes) !== journal.newBaselineHash
  ) {
    throw new Error("persistent transaction journal is inconsistent");
  }
  const auditTargetPath = path.resolve(
    organizationRoot,
    journal.auditRelativePath,
  );
  await assertSafeContainedPath({
    allowedRoot: organizationRoot,
    targetPath: auditTargetPath,
    allowMissing: true,
    label: "transaction audit target",
  });
  validateAuditRecord(auditRecord.value, path.basename(auditTargetPath));
  if (
    auditRecord.value.oldBaselineHash !== journal.oldBaselineHash ||
    auditRecord.value.newBaselineHash !== journal.newBaselineHash
  ) {
    throw new Error("transaction audit hashes do not match journal");
  }

  let currentHash = null;
  try {
    currentHash = (await hardenedReadBaseline(
      organizationRoot,
      baselinePath,
    )).hash;
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  if (
    currentHash !== null &&
    currentHash !== journal.oldBaselineHash &&
    currentHash !== journal.newBaselineHash
  ) {
    throw new Error("baseline changed externally during crash recovery");
  }

  let existingAudit = null;
  try {
    existingAudit = await fs.readFile(auditTargetPath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  if (existingAudit && !existingAudit.equals(auditRecord.bytes)) {
    throw new Error("transaction audit target conflicts with staged audit");
  }
  if (!existingAudit) {
    await durableWriteNew(auditTargetPath, auditRecord.bytes);
  }
  if (currentHash !== journal.newBaselineHash) {
    await fs.rm(baselinePath, { force: true });
    await durableWriteNew(baselinePath, newRecord.bytes);
  }
  const recoveredGuard = await hardenedCheckCore({
    controlCenterRoot,
    organizationRoot,
    baseline: newRecord.value,
    validateAudits: true,
  });
  if (!recoveredGuard.ok) {
    throw new Error("recovered transaction does not pass the scope guard");
  }
  await fs.rm(paths.root, { recursive: true, force: true });
  await syncDirectoryBestEffort(path.dirname(paths.root));
  return true;
}

function rootControlCenterOwnedError() {
  const error = new Error(ROOT_CONTROL_CENTER_OWNED);
  error.code = ROOT_CONTROL_CENTER_OWNED;
  return error;
}

function baselineOverrideForbiddenError() {
  const error = new Error(BASELINE_OVERRIDE_FORBIDDEN);
  error.code = BASELINE_OVERRIDE_FORBIDDEN;
  return error;
}

function handoffIntegrityError() {
  const error = new Error(HANDOFF_INTEGRITY_ERROR);
  error.code = HANDOFF_INTEGRITY_ERROR;
  return error;
}

async function observeNodeState(absolutePath, relativePath) {
  let stat;
  try {
    stat = await fs.lstat(absolutePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return { path: relativePath, exists: false };
    }
    throw error;
  }
  if (stat.isSymbolicLink()) {
    return {
      path: relativePath,
      exists: true,
      type: "symbolic-link",
      nlink: stat.nlink,
      linkTarget: normalizeRelativePath(await fs.readlink(absolutePath)),
    };
  }
  if (stat.isFile()) {
    const bytes = await fs.readFile(absolutePath);
    return {
      path: relativePath,
      exists: true,
      type: "file",
      nlink: stat.nlink,
      bytes: bytes.length,
      sha256: sha256(bytes),
    };
  }
  if (stat.isDirectory()) {
    const entries = await fs.readdir(absolutePath, { withFileTypes: true });
    entries.sort((left, right) => comparePaths(left.name, right.name));
    const children = [];
    for (const entry of entries) {
      const childRelativePath = `${relativePath}/${entry.name}`;
      children.push(
        await observeNodeState(
          path.join(absolutePath, entry.name),
          childRelativePath,
        ),
      );
    }
    return {
      path: relativePath,
      exists: true,
      type: "directory",
      nlink: stat.nlink,
      children,
    };
  }
  return {
    path: relativePath,
    exists: true,
    type: "other",
    nlink: stat.nlink,
    bytes: stat.size,
  };
}

async function observeChangedPath(controlCenterRoot, relativePath) {
  const segments = normalizeRelativePath(relativePath).split("/");
  let currentPath = path.resolve(controlCenterRoot);
  for (let index = 0; index < segments.length - 1; index += 1) {
    currentPath = path.join(currentPath, segments[index]);
    let stat;
    try {
      stat = await fs.lstat(currentPath);
    } catch (error) {
      if (error.code === "ENOENT") {
        return {
          path: relativePath,
          exists: false,
          blockedAt: segments.slice(0, index + 1).join("/"),
          blockedBy: "missing-ancestor",
        };
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      return {
        path: relativePath,
        exists: false,
        blockedAt: segments.slice(0, index + 1).join("/"),
        blockedBy: "symbolic-link-ancestor",
        nlink: stat.nlink,
        linkTarget: normalizeRelativePath(await fs.readlink(currentPath)),
      };
    }
    if (!stat.isDirectory()) {
      return {
        path: relativePath,
        exists: false,
        blockedAt: segments.slice(0, index + 1).join("/"),
        blockedBy: "non-directory-ancestor",
        nlink: stat.nlink,
      };
    }
  }
  return observeNodeState(
    path.join(controlCenterRoot, ...segments),
    relativePath,
  );
}

async function calculateObservedStateHash(controlCenterRoot, changedPaths) {
  const observations = [];
  for (const relativePath of changedPaths) {
    observations.push(
      await observeChangedPath(controlCenterRoot, relativePath),
    );
  }
  return sha256(
    Buffer.from(
      canonicalJson({ schemaVersion: 1, observations }),
      "utf8",
    ),
  );
}

const HANDOFF_KEYS = Object.freeze([
  "authorityBoundary",
  "baselineHash",
  "changedPaths",
  "detectedAt",
  "evidenceRefs",
  "observedStateHash",
  "organizationId",
  "requestedAction",
  "schemaVersion",
  "status",
]);

async function validateExistingHandoff({
  handoffPath,
  identity,
  baselineHash,
  changedPaths,
  observedStateHash,
}) {
  let lstat;
  try {
    lstat = await fs.lstat(handoffPath);
  } catch {
    throw handoffIntegrityError();
  }
  if (
    lstat.isSymbolicLink() ||
    !lstat.isFile() ||
    lstat.nlink !== 1
  ) {
    throw handoffIntegrityError();
  }

  let handle;
  let bytes;
  try {
    handle = await fs.open(handoffPath, "r");
    const openedStat = await handle.stat();
    if (
      !openedStat.isFile() ||
      openedStat.nlink !== 1 ||
      openedStat.dev !== lstat.dev ||
      openedStat.ino !== lstat.ino
    ) {
      throw handoffIntegrityError();
    }
    bytes = await handle.readFile();
  } catch (error) {
    if (error.code === HANDOFF_INTEGRITY_ERROR) {
      throw error;
    }
    throw handoffIntegrityError();
  } finally {
    await handle?.close();
  }

  let handoff;
  try {
    handoff = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw handoffIntegrityError();
  }
  if (bytes.toString("utf8") !== `${JSON.stringify(handoff, null, 2)}\n`) {
    throw handoffIntegrityError();
  }
  if (
    !handoff ||
    typeof handoff !== "object" ||
    Array.isArray(handoff) ||
    !arraysEqual(Object.keys(handoff).sort(comparePaths), HANDOFF_KEYS) ||
    handoff.schemaVersion !== 1 ||
    handoff.organizationId !== ORGANIZATION_OWNER ||
    !isStrictApprovedAt(handoff.detectedAt) ||
    handoff.baselineHash !== baselineHash ||
    !arraysEqual(handoff.changedPaths ?? [], changedPaths) ||
    handoff.observedStateHash !== observedStateHash ||
    handoff.status !== "awaiting-control-center-review" ||
    handoff.requestedAction !==
      "control-center-review-protected-root-change" ||
    handoff.authorityBoundary !== "organization-read-only" ||
    !Array.isArray(handoff.evidenceRefs) ||
    handoff.evidenceRefs.length !== 0 ||
    path.basename(handoffPath) !== `${identity}.json`
  ) {
    throw handoffIntegrityError();
  }
  return handoff;
}

async function validateExistingHandoffAfterConcurrentCommit(options) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    try {
      return await validateExistingHandoff(options);
    } catch (error) {
      if (error.code !== HANDOFF_INTEGRITY_ERROR || attempt === 24) {
        throw error;
      }
      await delay(10);
    }
  }
  throw handoffIntegrityError();
}

async function writeRootChangeHandoff({
  organizationRoot,
  baselineHash,
  changedPaths,
  observedStateHash,
}) {
  const identity = sha256(
    Buffer.from(
      canonicalJson({ baselineHash, changedPaths, observedStateHash }),
      "utf8",
    ),
  );
  const handoffDirectory = path.join(
    organizationRoot,
    HANDOFF_RELATIVE_DIRECTORY,
  );
  await assertSafeContainedPath({
    allowedRoot: organizationRoot,
    targetPath: handoffDirectory,
    allowMissing: true,
    label: "root change handoff directory",
  });
  await fs.mkdir(handoffDirectory, { recursive: true });
  await assertSafeContainedPath({
    allowedRoot: organizationRoot,
    targetPath: handoffDirectory,
    label: "root change handoff directory",
  });

  const handoffPath = path.join(handoffDirectory, `${identity}.json`);
  try {
    await assertSafeContainedPath({
      allowedRoot: organizationRoot,
      targetPath: handoffPath,
      allowMissing: true,
      label: "root change handoff",
    });
  } catch {
    throw handoffIntegrityError();
  }
  const handoff = {
    schemaVersion: 1,
    organizationId: ORGANIZATION_OWNER,
    detectedAt: new Date().toISOString(),
    baselineHash,
    changedPaths,
    observedStateHash,
    status: "awaiting-control-center-review",
    requestedAction: "control-center-review-protected-root-change",
    authorityBoundary: "organization-read-only",
    evidenceRefs: [],
  };
  const bytes = Buffer.from(`${JSON.stringify(handoff, null, 2)}\n`, "utf8");
  const tempPath = path.join(
    handoffDirectory,
    `.${identity}.${process.pid}.${randomUUID()}.tmp`,
  );
  let tempHandle;
  let tempExists = false;
  try {
    tempHandle = await fs.open(tempPath, "wx", 0o600);
    tempExists = true;
    await tempHandle.writeFile(bytes);
    await tempHandle.sync();
    await tempHandle.close();
    tempHandle = null;
    try {
      await fs.link(tempPath, handoffPath);
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
      await fs.unlink(tempPath);
      tempExists = false;
      await validateExistingHandoffAfterConcurrentCommit({
        handoffPath,
        identity,
        baselineHash,
        changedPaths,
        observedStateHash,
      });
      return { handoffId: identity, handoffPath };
    }
    await fs.unlink(tempPath);
    tempExists = false;
    await syncDirectoryBestEffort(handoffDirectory);
    await validateExistingHandoff({
      handoffPath,
      identity,
      baselineHash,
      changedPaths,
      observedStateHash,
    });
  } catch (error) {
    try {
      await tempHandle?.close();
    } catch {
      // Preserve the primary failure.
    }
    if (tempExists) {
      try {
        await fs.unlink(tempPath);
      } catch (cleanupError) {
        if (cleanupError.code !== "ENOENT") {
          throw cleanupError;
        }
      }
    }
    throw error;
  }

  return { handoffId: identity, handoffPath };
}

export async function checkProtectedRoot(options = {}) {
  if (
    Object.prototype.hasOwnProperty.call(options, "baseline") ||
    Object.prototype.hasOwnProperty.call(options, "baselinePath")
  ) {
    throw baselineOverrideForbiddenError();
  }
  const {
    controlCenterRoot,
    organizationRoot,
  } = options;
  if (!controlCenterRoot || !organizationRoot) {
    throw new Error("controlCenterRoot and organizationRoot are required");
  }
  const resolvedControlRoot = path.resolve(controlCenterRoot);
  const resolvedOrganizationRoot = path.resolve(organizationRoot);
  await assertSafeContainedPath({
    allowedRoot: resolvedControlRoot,
    targetPath: resolvedOrganizationRoot,
    label: "organizationRoot",
  });
  const baselineRecord = await hardenedReadBaseline(
    resolvedOrganizationRoot,
    undefined,
  );
  const guard = await hardenedCheckCore({
    controlCenterRoot: resolvedControlRoot,
    organizationRoot: resolvedOrganizationRoot,
    baseline: baselineRecord.baseline,
    validateAudits: false,
  });
  if (guard.ok) {
    return {
      ...guard,
      handoffId: null,
      handoffPath: null,
    };
  }
  const observedStateHash = await calculateObservedStateHash(
    resolvedControlRoot,
    guard.changedPaths,
  );
  const handoff = await writeRootChangeHandoff({
    organizationRoot: resolvedOrganizationRoot,
    baselineHash: baselineRecord.hash,
    changedPaths: guard.changedPaths,
    observedStateHash,
  });
  return { ...guard, ...handoff };
}

async function readStrictEvidence({
  controlCenterRoot,
  sourceTaskRef,
  changedPaths,
  approvedBy,
  approvedAt,
  reason,
}) {
  const normalizedRef = normalizeRelativePath(String(sourceTaskRef ?? "").trim());
  if (
    !normalizedRef.endsWith(".json") ||
    path.isAbsolute(normalizedRef) ||
    normalizedRef.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw new Error("sourceTaskRef must be a safe local JSON evidence path");
  }
  const evidencePath = path.resolve(controlCenterRoot, normalizedRef);
  await assertSafeContainedPath({
    allowedRoot: controlCenterRoot,
    targetPath: evidencePath,
    label: "source task evidence",
  });
  const evidenceRecord = await readCanonicalJsonFile(
    evidencePath,
    "source task evidence",
  );
  const evidence = evidenceRecord.value;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error("source task evidence must be a JSON object");
  }
  for (const key of EVIDENCE_REQUIRED_KEYS) {
    if (!(key in evidence)) {
      throw new Error(`source task evidence missing field: ${key}`);
    }
  }
  if (
    evidence.schemaVersion !== 1 ||
    typeof evidence.sourceTaskId !== "string" ||
    !evidence.sourceTaskId.trim() ||
    typeof evidence.sourceThreadId !== "string" ||
    !UUID_PATTERN.test(evidence.sourceThreadId) ||
    typeof evidence.title !== "string" ||
    !evidence.title.trim() ||
    evidence.approvedBy !== approvedBy ||
    evidence.approvedAt !== approvedAt ||
    evidence.reason !== reason.trim()
  ) {
    throw new Error("source task evidence does not exactly match approval CLI");
  }
  if (
    !reason.includes(evidence.title) ||
    !reason.includes(evidence.sourceThreadId)
  ) {
    throw new Error("reason must include exact evidence title and thread id");
  }
  const evidencePaths = sortedUniqueStringPaths(
    evidence.changedPaths,
    "source evidence changedPaths",
  );
  if (!arraysEqual(evidencePaths, changedPaths)) {
    throw new Error(
      "source evidence changedPaths do not match the complete guard diff",
    );
  }
  const evidenceOwners = collectEvidenceOwners(evidence);
  if (
    evidenceOwners.includes(ORGANIZATION_OWNER) ||
    !evidenceOwners.some((owner) => ROOT_EVIDENCE_OWNERS.has(owner))
  ) {
    throw new Error(
      "source evidence does not prove an independently authorized root task",
    );
  }

  const changelogPath = path.join(controlCenterRoot, "CHANGELOG.md");
  await assertSafeContainedPath({
    allowedRoot: controlCenterRoot,
    targetPath: changelogPath,
    label: "root CHANGELOG.md",
  });
  const changelogText = await fs.readFile(changelogPath, "utf8");
  for (const requiredText of [
    evidence.sourceTaskId,
    evidence.title,
    normalizedRef,
    ...changedPaths,
  ]) {
    if (!changelogText.includes(requiredText)) {
      throw new Error(
        `CHANGELOG.md auxiliary record is missing: ${requiredText}`,
      );
    }
  }
  return { evidence, normalizedRef };
}

async function preparePersistentTransaction({
  baselinePath,
  organizationRoot,
  oldBaselineBytes,
  newBaselineBytes,
  auditBytes,
  oldBaselineHash,
  newBaselineHash,
  auditTargetPath,
}) {
  const paths = transactionPaths(baselinePath);
  await assertSafeContainedPath({
    allowedRoot: path.dirname(baselinePath),
    targetPath: paths.root,
    allowMissing: true,
    label: "protected root transaction",
  });
  await fs.mkdir(paths.root);
  try {
    await durableWriteNew(paths.oldBaseline, oldBaselineBytes);
    await durableWriteNew(paths.newBaseline, newBaselineBytes);
    await durableWriteNew(paths.newAudit, auditBytes);
    const journal = {
      schemaVersion: 1,
      phase: "prepared",
      oldBaselineHash,
      newBaselineHash,
      auditRelativePath: relativePathFrom(
        organizationRoot,
        auditTargetPath,
      ),
    };
    await writeTransactionJournal(paths, journal);
    crashAfterPhase("prepared");
    return { paths, journal };
  } catch (error) {
    if (
      process.env.AI_BRAND_OFFICER_REBASELINE_CRASH_AFTER_PHASE !==
      "prepared"
    ) {
      await fs.rm(paths.root, { recursive: true, force: true });
    }
    throw error;
  }
}

async function updateTransactionPhase(transaction, phase) {
  transaction.journal.phase = phase;
  await writeTransactionJournal(transaction.paths, transaction.journal);
  crashAfterPhase(phase);
}

export async function rebaselineProtectedRoot(..._args) {
  throw rootControlCenterOwnedError();
}

function parseHardenedCliArguments(argv) {
  if (!argv.includes("--check")) {
    throw rootControlCenterOwnedError();
  }
  const valueOptions = new Set([
    "control-center-root",
    "organization-root",
  ]);
  const output = { check: true };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      throw rootControlCenterOwnedError();
    }
    const key = argument.slice(2);
    if (key !== "check" && !valueOptions.has(key)) {
      throw rootControlCenterOwnedError();
    }
    if (seen.has(key)) {
      throw rootControlCenterOwnedError();
    }
    seen.add(key);
    if (key === "check") {
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw rootControlCenterOwnedError();
    }
    output[key] = value;
    index += 1;
  }
  return output;
}

function hardenedFormatGuardFailure(change) {
  if (change.category === "protected-root-audit-chain") {
    return `FAIL: protected root audit chain invalid: ${change.reason}`;
  }
  return formatGuardFailure(change);
}

async function runHardenedCli() {
  const args = parseHardenedCliArguments(process.argv.slice(2));
  const organizationRoot = path.resolve(
    args["organization-root"] ?? path.resolve(SCRIPT_DIR, ".."),
  );
  const controlCenterRoot = path.resolve(
    args["control-center-root"] ??
      path.resolve(organizationRoot, "..", ".."),
  );
  const result = await checkProtectedRoot({
    controlCenterRoot,
    organizationRoot,
  });
  if (!result.ok) {
    for (const change of result.changes) {
      console.error(hardenedFormatGuardFailure(change));
    }
    process.exitCode = 1;
    return;
  }
  console.log("PASS: protected root paths unchanged.");
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(SCRIPT_PATH)) {
  runHardenedCli().catch((error) => {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  });
}
