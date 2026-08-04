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
const CONFIG_DIRECTORY = path.join(ORGANIZATION_ROOT, "config");
const SCHEMA_DIRECTORY = path.join(ORGANIZATION_ROOT, "schemas");
const BASELINE_PATH = path.join(
  ORGANIZATION_ROOT,
  "temp",
  "implementation-baseline",
  "protected-root-files.json",
);

const ORGANIZATION_CONFIG_PATH = path.join(
  CONFIG_DIRECTORY,
  "organization.json",
);
const BRAND_OFFICER_CONFIG_PATH = path.join(
  CONFIG_DIRECTORY,
  "brand-officer.json",
);
const ORGANIZATION_SCHEMA_PATH = path.join(
  SCHEMA_DIRECTORY,
  "organization.schema.json",
);
const BRAND_OFFICER_SCHEMA_PATH = path.join(
  SCHEMA_DIRECTORY,
  "brand-officer.schema.json",
);
const EXPECTED_CHARTER_RELATIVE_PATH =
  "organizations/ai-brand-officer/ORGANIZATION.md";
const CHARTER_PATH_ERROR_CODE = "ROOT_OWNED_CHARTER_PATH_INVALID";

const EXPECTED_CORE_SKILLS = [
  {
    id: "brand-positioning",
    name: "品牌定位",
    status: "pilot",
  },
  {
    id: "brand-visual",
    name: "品牌视觉",
    status: "pilot",
  },
  {
    id: "brand-communication",
    name: "品牌传播",
    status: "pilot",
  },
];

const EXPECTED_PUBLIC_CAPABILITIES = [
  {
    id: "public.promotional-poster",
    maturity: "formal",
    reference: "skills/creating-promotional-posters/SKILL.md",
  },
  {
    id: "public.taobao-ecommerce-image-set",
    maturity: "pilot",
    reference: "workflows/TAOBAO_ECOMMERCE_IMAGE_SET_PILOT.md",
  },
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function clone(value) {
  return structuredClone(value);
}

function throwCharterPathError(reason) {
  const error = new Error(`${CHARTER_PATH_ERROR_CODE}: ${reason}`);
  error.code = CHARTER_PATH_ERROR_CODE;
  throw error;
}

function resolveFixedCharterPathWithinRoot(root, charterPath, label) {
  if (charterPath !== EXPECTED_CHARTER_RELATIVE_PATH) {
    throwCharterPathError(`${label} path is not the fixed charter path`);
  }

  const resolvedRoot = path.resolve(root);
  const expectedPath = path.resolve(
    resolvedRoot,
    ...EXPECTED_CHARTER_RELATIVE_PATH.split("/"),
  );
  const resolvedPath = path.resolve(
    resolvedRoot,
    ...charterPath.split("/"),
  );
  const relativePath = path.relative(resolvedRoot, resolvedPath);
  const isStrictlyInside =
    relativePath.length > 0 &&
    !path.isAbsolute(relativePath) &&
    !relativePath.startsWith("..");

  if (!isStrictlyInside || resolvedPath !== expectedPath) {
    throwCharterPathError(`${label} path escaped or drifted`);
  }
  return resolvedPath;
}

function resolveRealCharterSource(charterPath) {
  const sourcePath = resolveFixedCharterPathWithinRoot(
    CONTROL_CENTER_ROOT,
    charterPath,
    "real source",
  );
  const expectedRealCharterPath = path.resolve(
    CONTROL_CENTER_ROOT,
    ...EXPECTED_CHARTER_RELATIVE_PATH.split("/"),
  );
  if (sourcePath !== expectedRealCharterPath) {
    throwCharterPathError("real source is not the expected charter");
  }
  return sourcePath;
}

function validateJsonSchema(schema, value, instancePath = "$") {
  const errors = [];
  const fail = (message) => errors.push(`${instancePath}: ${message}`);

  if (
    Object.hasOwn(schema, "const") &&
    JSON.stringify(value) !== JSON.stringify(schema.const)
  ) {
    fail(`must equal const ${JSON.stringify(schema.const)}`);
    return errors;
  }
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some(
      (candidate) => JSON.stringify(candidate) === JSON.stringify(value),
    )
  ) {
    fail(`must be one of ${JSON.stringify(schema.enum)}`);
    return errors;
  }

  if (schema.type === "object") {
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      fail("must be an object");
      return errors;
    }
    for (const requiredName of schema.required ?? []) {
      if (!Object.hasOwn(value, requiredName)) {
        errors.push(`${instancePath}.${requiredName}: is required`);
      }
    }
    const knownProperties = schema.properties ?? {};
    if (schema.additionalProperties === false) {
      for (const propertyName of Object.keys(value)) {
        if (!Object.hasOwn(knownProperties, propertyName)) {
          errors.push(
            `${instancePath}.${propertyName}: additional property is forbidden`,
          );
        }
      }
    }
    for (const [propertyName, propertySchema] of Object.entries(
      knownProperties,
    )) {
      if (Object.hasOwn(value, propertyName)) {
        errors.push(
          ...validateJsonSchema(
            propertySchema,
            value[propertyName],
            `${instancePath}.${propertyName}`,
          ),
        );
      }
    }
    return errors;
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      fail("must be an array");
      return errors;
    }
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      fail(`must contain at least ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      fail(`must contain at most ${schema.maxItems} items`);
    }
    for (let index = 0; index < (schema.prefixItems ?? []).length; index += 1) {
      if (index < value.length) {
        errors.push(
          ...validateJsonSchema(
            schema.prefixItems[index],
            value[index],
            `${instancePath}[${index}]`,
          ),
        );
      }
    }
    if (
      schema.items &&
      schema.items !== false &&
      !Array.isArray(schema.prefixItems)
    ) {
      for (let index = 0; index < value.length; index += 1) {
        errors.push(
          ...validateJsonSchema(
            schema.items,
            value[index],
            `${instancePath}[${index}]`,
          ),
        );
      }
    }
    if (
      schema.items === false &&
      value.length > (schema.prefixItems ?? []).length
    ) {
      fail("contains an item outside the locked tuple");
    }
    return errors;
  }

  if (schema.type === "string" && typeof value !== "string") {
    fail("must be a string");
  } else if (
    schema.type === "integer" &&
    (!Number.isInteger(value) || typeof value !== "number")
  ) {
    fail("must be an integer");
  }
  return errors;
}

function assertSchemaAccepts(schema, value) {
  assert.deepEqual(validateJsonSchema(schema, value), []);
}

function assertSchemaRejects(schema, value, message) {
  const errors = validateJsonSchema(schema, value);
  assert.notEqual(errors.length, 0, message);
}

function assertStrictObjectSchema(schema, label) {
  assert.equal(
    schema.$schema,
    "https://json-schema.org/draft/2020-12/schema",
  );
  assert.equal(schema.type, "object");
  assert.equal(
    schema.additionalProperties,
    false,
    `${label} must reject unknown root fields`,
  );
}

async function loadConfigurationBundle() {
  const [organization, brandOfficer, organizationSchema, brandOfficerSchema] =
    await Promise.all([
      readJson(ORGANIZATION_CONFIG_PATH),
      readJson(BRAND_OFFICER_CONFIG_PATH),
      readJson(ORGANIZATION_SCHEMA_PATH),
      readJson(BRAND_OFFICER_SCHEMA_PATH),
    ]);
  return {
    organization,
    brandOfficer,
    organizationSchema,
    brandOfficerSchema,
  };
}

async function charterMatchesRootOwnedBaseline(controlCenterRoot) {
  const baseline = await readJson(BASELINE_PATH);
  const charter = baseline.rootOwnedOrganizationCharter;
  const charterPath = resolveFixedCharterPathWithinRoot(
    controlCenterRoot,
    charter.path,
    "baseline comparison",
  );
  let bytes;
  try {
    bytes = await fs.readFile(charterPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
  if (bytes.byteLength !== charter.originalFileByteLength) {
    return false;
  }
  if (sha256(bytes) !== charter.originalFileSha256) {
    return false;
  }
  for (const section of charter.requiredRootOwnedSections) {
    const sectionBytes = bytes.subarray(section.byteStart, section.byteEnd);
    if (
      sectionBytes.byteLength !== section.byteLength ||
      sha256(sectionBytes) !== section.sha256
    ) {
      return false;
    }
  }
  return true;
}

async function createCharterFixture(options = {}) {
  const baseline = options.baseline ?? (await readJson(BASELINE_PATH));
  const charterPath = baseline.rootOwnedOrganizationCharter.path;
  const realCharterPath = resolveRealCharterSource(charterPath);
  const fixtureRoot = options.fixtureRoot
    ? path.resolve(options.fixtureRoot)
    : await fs.mkdtemp(
        path.join(os.tmpdir(), "brand-officer-config-charter-"),
      );
  const fixtureCharterPath = resolveFixedCharterPathWithinRoot(
    fixtureRoot,
    charterPath,
    "fixture target",
  );
  await fs.mkdir(path.dirname(fixtureCharterPath), { recursive: true });
  await fs.copyFile(realCharterPath, fixtureCharterPath);
  return { fixtureRoot, fixtureCharterPath };
}

test("organization configuration locks identity, three core skills, and two separate public capabilities", async () => {
  const { organization } = await loadConfigurationBundle();

  assert.equal(organization.organizationId, "ai-brand-officer");
  assert.equal(organization.deploymentMode, "same_project_organization_module");
  assert.equal(organization.coreSkills.length, 3);
  assert.deepEqual(
    organization.coreSkills.map((item) => item.id),
    ["brand-positioning", "brand-visual", "brand-communication"],
  );
  assert.equal(organization.rootControllerRegistration, "registered_designing");
  assert.equal(organization.peerOrganizationCalls, "contract_only");
  assert.equal(organization.publicCapabilities.length, 2);
  assert.equal(organization.displayName, "品AI品牌官");
  assert.equal(organization.directory, "organizations/ai-brand-officer");
  assert.deepEqual(organization.coreSkills, EXPECTED_CORE_SKILLS);
  assert.deepEqual(
    organization.publicCapabilities,
    EXPECTED_PUBLIC_CAPABILITIES,
  );
});

test("organization schema is strict 2020-12 and accepts the canonical configuration", async () => {
  const { organization, organizationSchema } =
    await loadConfigurationBundle();
  assertStrictObjectSchema(organizationSchema, "organization schema");
  assertSchemaAccepts(organizationSchema, organization);
});

test("brand officer schema locks capability states, safe roots, registration, and disabled knowledge writeback", async () => {
  const { brandOfficer, brandOfficerSchema } =
    await loadConfigurationBundle();
  assertStrictObjectSchema(brandOfficerSchema, "brand officer schema");
  assertSchemaAccepts(brandOfficerSchema, brandOfficer);
  assert.equal(brandOfficer.organizationId, "ai-brand-officer");
  assert.equal(brandOfficer.rootControllerRegistration, "registered_designing");
  assert.deepEqual(brandOfficer.capabilities, EXPECTED_CORE_SKILLS);
  assert.deepEqual(brandOfficer.paths, {
    enterpriseRoot: "brands/enterprises",
    tempRoot: "temp/positioning-jobs",
    outputRoot: "outputs",
  });
  assert.equal(brandOfficer.feishuKnowledgeWriteback, "disabled");
});

test("public capabilities cannot be mixed into coreSkills", async () => {
  const { organization, organizationSchema } =
    await loadConfigurationBundle();
  const drifted = clone(organization);
  drifted.coreSkills[0] = {
    id: "public.promotional-poster",
    name: "普通宣传海报",
    status: "formal",
  };
  assertSchemaRejects(
    organizationSchema,
    drifted,
    "public capabilities must not count as core skills",
  );
});

test("Taobao public capability cannot claim formal maturity", async () => {
  const { organization, organizationSchema } =
    await loadConfigurationBundle();
  const drifted = clone(organization);
  drifted.publicCapabilities[1].maturity = "formal";
  assertSchemaRejects(organizationSchema, drifted);
});

test("root controller cannot claim connected", async () => {
  const { organization, organizationSchema, brandOfficer, brandOfficerSchema } =
    await loadConfigurationBundle();
  const driftedOrganization = {
    ...organization,
    rootControllerRegistration: "connected",
  };
  const driftedBrandOfficer = {
    ...brandOfficer,
    rootControllerRegistration: "connected",
  };
  assertSchemaRejects(organizationSchema, driftedOrganization);
  assertSchemaRejects(brandOfficerSchema, driftedBrandOfficer);
});

test("peer organization calls cannot claim enabled", async () => {
  const { organization, organizationSchema } =
    await loadConfigurationBundle();
  assertSchemaRejects(organizationSchema, {
    ...organization,
    peerOrganizationCalls: "enabled",
  });
});

test("organization directory cannot escape its fixed module path", async () => {
  const { organization, organizationSchema } =
    await loadConfigurationBundle();
  assertSchemaRejects(organizationSchema, {
    ...organization,
    directory: "../outside",
  });
});

test("unknown fields are rejected in both configurations and nested objects", async () => {
  const { organization, organizationSchema, brandOfficer, brandOfficerSchema } =
    await loadConfigurationBundle();
  assertSchemaRejects(organizationSchema, {
    ...organization,
    unknownRootField: true,
  });
  const nestedOrganization = clone(organization);
  nestedOrganization.coreSkills[0].unknownNestedField = true;
  assertSchemaRejects(organizationSchema, nestedOrganization);
  assertSchemaRejects(brandOfficerSchema, {
    ...brandOfficer,
    unknownRootField: true,
  });
  const nestedBrandOfficer = clone(brandOfficer);
  nestedBrandOfficer.paths.unknownNestedField = "outside";
  assertSchemaRejects(brandOfficerSchema, nestedBrandOfficer);
});

test("brand officer path drift is rejected", async () => {
  const { brandOfficer, brandOfficerSchema } =
    await loadConfigurationBundle();
  for (const [key, value] of [
    ["enterpriseRoot", "../enterprises"],
    ["tempRoot", "temp/other-jobs"],
    ["outputRoot", "organizations/ai-brand-officer/outputs"],
  ]) {
    const drifted = clone(brandOfficer);
    drifted.paths[key] = value;
    assertSchemaRejects(brandOfficerSchema, drifted);
  }
});

test("Feishu knowledge writeback cannot be enabled", async () => {
  const { brandOfficer, brandOfficerSchema } =
    await loadConfigurationBundle();
  assertSchemaRejects(brandOfficerSchema, {
    ...brandOfficer,
    feishuKnowledgeWriteback: "enabled",
  });
});

test("rewriting ORGANIZATION.md while creating configuration fails against the Task 1 charter baseline", async () => {
  const fixture = await createCharterFixture();
  try {
    assert.equal(await charterMatchesRootOwnedBaseline(fixture.fixtureRoot), true);
    await fs.appendFile(
      fixture.fixtureCharterPath,
      "\n## Generated configuration rewrite\n",
      "utf8",
    );
    assert.equal(
      await charterMatchesRootOwnedBaseline(fixture.fixtureRoot),
      false,
    );
  } finally {
    await fs.rm(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

test("deleting and regenerating ORGANIZATION.md fails against the Task 1 charter baseline", async () => {
  const fixture = await createCharterFixture();
  try {
    assert.equal(await charterMatchesRootOwnedBaseline(fixture.fixtureRoot), true);
    await fs.rm(fixture.fixtureCharterPath);
    await fs.writeFile(
      fixture.fixtureCharterPath,
      "# 品AI品牌官\n\n- 组织 ID：`ai-brand-officer`\n",
      "utf8",
    );
    assert.equal(
      await charterMatchesRootOwnedBaseline(fixture.fixtureRoot),
      false,
    );
  } finally {
    await fs.rm(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

test("corrupted charter paths are rejected before fixture writes and cannot touch an external sentinel", async () => {
  const sandboxRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "brand-officer-charter-path-safety-"),
  );
  const fixtureRoot = path.join(sandboxRoot, "fixture");
  const fixtureMarkerPath = path.join(fixtureRoot, "preexisting-marker.txt");
  const sentinelPath = path.join(sandboxRoot, "outside-sentinel.txt");
  const sentinelBytes = Buffer.from("must remain byte exact\n", "utf8");
  await fs.mkdir(fixtureRoot);
  await fs.writeFile(fixtureMarkerPath, "fixture must remain unchanged\n", "utf8");
  await fs.writeFile(sentinelPath, sentinelBytes);

  try {
    const diskBaseline = await readJson(BASELINE_PATH);
    const maliciousPaths = [
      "../outside-sentinel.txt",
      path.resolve(sentinelPath),
      "organizations/ai-brand-officer-evil/ORGANIZATION.md",
    ];

    for (const maliciousPath of maliciousPaths) {
      const baseline = clone(diskBaseline);
      baseline.rootOwnedOrganizationCharter.path = maliciousPath;
      const fixtureBefore = await fs.readdir(fixtureRoot);
      let unexpectedFixture = null;
      let observedError = null;

      try {
        unexpectedFixture = await createCharterFixture({
          baseline,
          fixtureRoot,
        });
      } catch (error) {
        observedError = error;
      } finally {
        if (
          unexpectedFixture?.fixtureRoot &&
          path.resolve(unexpectedFixture.fixtureRoot) !== path.resolve(fixtureRoot)
        ) {
          await fs.rm(unexpectedFixture.fixtureRoot, {
            recursive: true,
            force: true,
          });
        }
      }

      assert.equal(
        observedError?.code,
        "ROOT_OWNED_CHARTER_PATH_INVALID",
        `${maliciousPath} must be rejected before any fixture write`,
      );
      assert.deepEqual(await fs.readdir(fixtureRoot), fixtureBefore);
      assert.deepEqual(await fs.readFile(sentinelPath), sentinelBytes);
      assert.equal(
        await fs.readFile(fixtureMarkerPath, "utf8"),
        "fixture must remain unchanged\n",
      );
    }
  } finally {
    await fs.rm(sandboxRoot, { recursive: true, force: true });
  }
});
