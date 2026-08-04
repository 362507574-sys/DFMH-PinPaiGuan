import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  requireBusinessProjectId,
  requireEnterpriseId,
} from '../../../scripts/control-center/project_contract.mjs';
import { createProjectPaths } from '../../../scripts/control-center/project_paths.mjs';
import { validateTaskIdentity } from './brand_contracts.mjs';

const ORGANIZATION_ID = 'ai-brand-officer';
const workspaceLocks = new Map();

/**
 * Creates directories only. Callers must use the project's atomic store and
 * revalidate the target parent immediately before every file write. The
 * in-process mutex prevents cooperating calls from racing; it cannot eliminate
 * malicious cross-process filesystem replacement.
 */
export async function createBrandProjectWorkspace({
  projectRoot,
  enterpriseId,
  businessProjectId,
  taskId,
} = {}) {
  const identity = validateTaskIdentity({
    enterpriseId,
    businessProjectId,
    taskId,
  });
  const projectPaths = await createProjectPaths({ projectRoot });
  const projectDirectory = projectPaths.projectRoot(
    identity.enterpriseId,
    identity.businessProjectId,
  );
  const projectFile = projectPaths.projectFile(
    identity.enterpriseId,
    identity.businessProjectId,
  );
  const lockKey = `${projectDirectory}\u0000${identity.taskId}`;
  return exclusive(lockKey, () => createWorkspaceLocked({
    projectPaths,
    identity,
    projectDirectory,
    projectFile,
  }));
}

async function createWorkspaceLocked({
  projectPaths,
  identity,
  projectDirectory,
  projectFile,
}) {
  await assertProjectIdentityBoundary({
    businessRoot: projectPaths.businessRoot,
    projectDirectory,
    projectFile,
    enterpriseId: identity.enterpriseId,
  });

  const organizationRoot = projectPaths.organizationWorkspace(
    identity.enterpriseId,
    identity.businessProjectId,
    ORGANIZATION_ID,
  );
  const tasksRoot = path.join(organizationRoot, 'tasks');
  const taskRoot = path.join(tasksRoot, identity.taskId);
  const candidatesRoot = path.join(taskRoot, 'candidates');
  const reviewsRoot = path.join(taskRoot, 'reviews');
  const deliverablesRoot = path.join(taskRoot, 'deliverables');

  for (const [label, candidate] of [
    ['organizationRoot', organizationRoot],
    ['tasksRoot', tasksRoot],
    ['taskRoot', taskRoot],
    ['candidatesRoot', candidatesRoot],
    ['reviewsRoot', reviewsRoot],
    ['deliverablesRoot', deliverablesRoot],
  ]) {
    assertInside(projectDirectory, candidate, label, 'project boundary');
  }
  for (const [label, candidate] of [
    ['candidatesRoot', candidatesRoot],
    ['reviewsRoot', reviewsRoot],
    ['deliverablesRoot', deliverablesRoot],
  ]) {
    assertInside(taskRoot, candidate, label, 'task boundary');
  }

  for (const [directory, label] of [
    [path.join(projectDirectory, 'organizations'), 'organizations directory'],
    [organizationRoot, 'organization directory'],
    [tasksRoot, 'tasks directory'],
    [taskRoot, 'task directory'],
    [candidatesRoot, 'candidates directory'],
    [reviewsRoot, 'reviews directory'],
    [deliverablesRoot, 'deliverables directory'],
  ]) {
    await ensureRegularDirectory(directory, label);
  }

  for (const [label, candidate] of [
    ['organizationRoot', organizationRoot],
    ['taskRoot', taskRoot],
    ['candidatesRoot', candidatesRoot],
    ['reviewsRoot', reviewsRoot],
    ['deliverablesRoot', deliverablesRoot],
  ]) {
    const canonical = await fs.realpath(candidate);
    if (canonical !== path.resolve(candidate)) {
      throw new Error(`${label} contains a symbolic link`);
    }
    assertInside(projectDirectory, canonical, label, 'project boundary');
  }

  const result = {
    organizationRoot,
    taskRoot,
    planFile: path.join(taskRoot, 'plan.json'),
    evidenceFile: path.join(taskRoot, 'evidence.json'),
    debugStateFile: path.join(taskRoot, 'debug-state.json'),
    candidatesRoot,
    reviewsRoot,
    deliverablesRoot,
  };
  for (const [label, candidate] of Object.entries(result)) {
    assertInside(projectDirectory, candidate, label, 'project boundary');
    if (candidate.includes(`${path.sep}shared-artifacts${path.sep}`)) {
      throw new Error(`${label} must not expose shared-artifacts`);
    }
  }
  await verifyFinalWorkspaceBoundary({
    projectPaths,
    identity,
    projectDirectory,
    projectFile,
    organizationRoot,
    tasksRoot,
    taskRoot,
    candidatesRoot,
    reviewsRoot,
    deliverablesRoot,
    result,
  });
  return Object.freeze(result);
}

async function verifyFinalWorkspaceBoundary({
  projectPaths,
  identity,
  projectDirectory,
  projectFile,
  organizationRoot,
  tasksRoot,
  taskRoot,
  candidatesRoot,
  reviewsRoot,
  deliverablesRoot,
  result,
}) {
  await assertProjectIdentityBoundary({
    businessRoot: projectPaths.businessRoot,
    projectDirectory,
    projectFile,
    enterpriseId: identity.enterpriseId,
  });

  const organizationsRoot = path.join(projectDirectory, 'organizations');
  const canonicalProject = await fs.realpath(projectDirectory);
  const canonicalOrganization = await fs.realpath(organizationRoot);
  assertInside(
    canonicalProject,
    canonicalOrganization,
    'organizationRoot',
    'project boundary',
  );
  if (canonicalOrganization !== path.resolve(organizationRoot)) {
    throw new Error('organization boundary contains a symbolic link');
  }

  for (const [directory, label] of [
    [organizationsRoot, 'organizations directory'],
    [organizationRoot, 'organization directory'],
    [tasksRoot, 'tasks directory'],
    [taskRoot, 'task directory'],
    [candidatesRoot, 'candidates directory'],
    [reviewsRoot, 'reviews directory'],
    [deliverablesRoot, 'deliverables directory'],
  ]) {
    const observed = await fs.lstat(directory);
    await assertRegularDirectory(directory, observed, label);
    const canonical = await fs.realpath(directory);
    if (directory === organizationsRoot) {
      assertInside(canonicalProject, canonical, label, 'project boundary');
    } else if (directory !== organizationRoot) {
      assertInside(
        canonicalOrganization,
        canonical,
        label,
        'organization boundary',
      );
    }
  }

  for (const [label, candidate] of [
    ['planFile', result.planFile],
    ['evidenceFile', result.evidenceFile],
    ['debugStateFile', result.debugStateFile],
  ]) {
    const parent = path.dirname(candidate);
    const parentObserved = await fs.lstat(parent);
    await assertRegularDirectory(parent, parentObserved, `${label} parent`);
    const canonicalParent = await fs.realpath(parent);
    assertInside(
      canonicalOrganization,
      canonicalParent,
      `${label} parent`,
      'organization boundary',
    );
  }
}

async function assertProjectIdentityBoundary({
  businessRoot,
  projectDirectory,
  projectFile,
  enterpriseId,
}) {
  const enterpriseDirectory = path.join(businessRoot, enterpriseId);
  for (const [candidate, label] of [
    [businessRoot, 'business-projects directory'],
    [enterpriseDirectory, 'enterprise directory'],
    [projectDirectory, 'project directory'],
  ]) {
    const direct = await fs.lstat(candidate).catch((error) => {
      if (error?.code === 'ENOENT') {
        throw new Error('project does not exist', { cause: error });
      }
      throw error;
    });
    if (!direct.isDirectory() || direct.isSymbolicLink()) {
      throw new Error(`${label} must be a regular directory without a symbolic link`);
    }
  }

  const canonicalBusinessRoot = await fs.realpath(businessRoot);
  const canonicalProject = await fs.realpath(projectDirectory);
  assertInside(
    canonicalBusinessRoot,
    canonicalProject,
    'project directory',
    'project boundary',
  );
  if (canonicalProject !== path.resolve(projectDirectory)) {
    throw new Error('project boundary contains a symbolic link');
  }

  const projectIdentity = await fs.lstat(projectFile).catch((error) => {
    if (error?.code === 'ENOENT') {
      throw new Error('project does not exist: project.json is missing', { cause: error });
    }
    throw error;
  });
  if (!projectIdentity.isFile() || projectIdentity.isSymbolicLink()) {
    throw new Error('project identity must be a regular project.json file');
  }
  await validateStoredProjectIdentity(projectFile, {
    enterpriseId,
    businessProjectId: path.basename(projectDirectory),
  });
}

async function validateStoredProjectIdentity(
  projectFile,
  { enterpriseId, businessProjectId },
) {
  const raw = await fs.readFile(projectFile, 'utf8');
  let record;
  try {
    record = JSON.parse(raw);
  } catch (error) {
    throw new Error(`project identity JSON is invalid: ${error.message}`, {
      cause: error,
    });
  }
  if (
    record === null
    || typeof record !== 'object'
    || Array.isArray(record)
    || (Object.getPrototypeOf(record) !== Object.prototype
      && Object.getPrototypeOf(record) !== null)
  ) {
    throw new TypeError('project identity must be a plain object');
  }
  if (record.schemaVersion !== 1) {
    throw new Error('project identity schemaVersion must be 1');
  }
  requireEnterpriseId(record.enterpriseId);
  requireBusinessProjectId(record.businessProjectId);
  if (record.enterpriseId !== enterpriseId) {
    throw new Error('project identity enterpriseId does not match request');
  }
  if (record.businessProjectId !== businessProjectId) {
    throw new Error('project identity businessProjectId does not match request');
  }
}

async function ensureRegularDirectory(directory, label) {
  const existing = await fs.lstat(directory).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (existing) {
    await assertRegularDirectory(directory, existing, label);
    return;
  }
  try {
    await fs.mkdir(directory);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  const observed = await fs.lstat(directory);
  await assertRegularDirectory(directory, observed, label);
}

async function assertRegularDirectory(directory, observed, label) {
  if (!observed.isDirectory() || observed.isSymbolicLink()) {
    throw new Error(`${label} must be a regular directory without a symbolic link`);
  }
  const canonical = await fs.realpath(directory);
  if (canonical !== path.resolve(directory)) {
    throw new Error(`${label} must not contain a symbolic link`);
  }
}

function assertInside(base, candidate, label, boundaryLabel) {
  const relative = path.relative(path.resolve(base), path.resolve(candidate));
  if (
    relative === ''
    || relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw new Error(`${label} escapes its ${boundaryLabel}`);
  }
}

async function exclusive(key, operation) {
  const previous = workspaceLocks.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  workspaceLocks.set(key, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (workspaceLocks.get(key) === current) workspaceLocks.delete(key);
  }
}
