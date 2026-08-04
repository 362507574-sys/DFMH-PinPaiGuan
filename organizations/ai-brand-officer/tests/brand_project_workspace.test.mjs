import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createBrandProjectWorkspace } from '../scripts/brand_project_workspace.mjs';
import { makeBrandRuntimeFixture } from './helpers/brand_runtime_fixture.mjs';

const RETURNED_KEYS = Object.freeze([
  'candidatesRoot',
  'debugStateFile',
  'deliverablesRoot',
  'evidenceFile',
  'organizationRoot',
  'planFile',
  'reviewsRoot',
  'taskRoot',
]);

function assertInside(base, candidate, label) {
  const relative = path.relative(base, candidate);
  assert.notEqual(relative, '');
  assert.equal(path.isAbsolute(relative), false, `${label} must be relative`);
  assert.equal(
    relative === '..' || relative.startsWith(`..${path.sep}`),
    false,
    `${label} escaped`,
  );
}

test('workspace stays inside the current project brand-officer task tree', async (t) => {
  const fixture = await makeBrandRuntimeFixture(t);
  const paths = await createBrandProjectWorkspace({
    projectRoot: fixture.projectRoot,
    ...fixture.identity,
  });
  assert.deepEqual(Object.keys(paths).sort(), [...RETURNED_KEYS].sort());
  assert.equal(
    paths.organizationRoot,
    path.join(
      fixture.projectDirectory,
      'organizations',
      'ai-brand-officer',
    ),
  );
  assert.equal(
    paths.taskRoot,
    path.join(paths.organizationRoot, 'tasks', fixture.taskId),
  );
  for (const [label, candidate] of Object.entries(paths)) {
    assert.equal(path.isAbsolute(candidate), true, `${label} must be absolute`);
    assertInside(fixture.projectDirectory, candidate, label);
    assert.equal(/shared-artifacts/u.test(candidate), false);
  }
  assert.equal(Object.isFrozen(paths), true);
});

test('workspace creates only the expected task subdirectories and file paths', async (t) => {
  const fixture = await makeBrandRuntimeFixture(t);
  const paths = await createBrandProjectWorkspace({
    projectRoot: fixture.projectRoot,
    ...fixture.identity,
  });
  assert.deepEqual(
    (await fs.readdir(paths.taskRoot)).sort(),
    ['candidates', 'deliverables', 'reviews'],
  );
  for (const directory of [
    paths.organizationRoot,
    paths.taskRoot,
    paths.candidatesRoot,
    paths.reviewsRoot,
    paths.deliverablesRoot,
  ]) {
    assert.equal((await fs.stat(directory)).isDirectory(), true);
  }
  assert.equal(paths.planFile, path.join(paths.taskRoot, 'plan.json'));
  assert.equal(paths.evidenceFile, path.join(paths.taskRoot, 'evidence.json'));
  assert.equal(paths.debugStateFile, path.join(paths.taskRoot, 'debug-state.json'));
  await assert.rejects(fs.access(paths.planFile), /ENOENT/u);
  await assert.rejects(fs.access(paths.evidenceFile), /ENOENT/u);
  await assert.rejects(fs.access(paths.debugStateFile), /ENOENT/u);
  await assert.rejects(
    fs.access(path.join(fixture.projectDirectory, 'shared-artifacts')),
    /ENOENT/u,
  );
});

test('concurrent first creation for the same project task is idempotent', async (t) => {
  const fixture = await makeBrandRuntimeFixture(t);
  const request = {
    projectRoot: fixture.projectRoot,
    ...fixture.identity,
  };
  const [first, second] = await Promise.all([
    createBrandProjectWorkspace(request),
    createBrandProjectWorkspace(request),
  ]);
  assert.deepEqual(first, second);
  assert.deepEqual(
    (await fs.readdir(first.taskRoot)).sort(),
    ['candidates', 'deliverables', 'reviews'],
  );
});

test('same project task workspace operations are serialized in process', async (t) => {
  const fixture = await makeBrandRuntimeFixture(t);
  const request = {
    projectRoot: fixture.projectRoot,
    ...fixture.identity,
  };
  const interceptedDirectory = path.join(fixture.projectDirectory, 'organizations');
  const originalMkdir = fs.mkdir;
  let activeCalls = 0;
  let maximumActiveCalls = 0;
  let arrivals = 0;
  let releaseFirst;
  const secondArrival = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  fs.mkdir = async function instrumentedMkdir(directory, ...args) {
    if (path.resolve(directory) !== path.resolve(interceptedDirectory)) {
      return originalMkdir.call(this, directory, ...args);
    }
    arrivals += 1;
    activeCalls += 1;
    maximumActiveCalls = Math.max(maximumActiveCalls, activeCalls);
    if (arrivals === 2) releaseFirst();
    if (arrivals === 1) {
      await Promise.race([
        secondArrival,
        new Promise((resolve) => setTimeout(resolve, 50)),
      ]);
    }
    try {
      return await originalMkdir.call(this, directory, ...args);
    } finally {
      activeCalls -= 1;
    }
  };

  try {
    const results = await Promise.all([
      createBrandProjectWorkspace(request),
      createBrandProjectWorkspace(request),
    ]);
    assert.deepEqual(results[0], results[1]);
    assert.equal(maximumActiveCalls, 1);
  } finally {
    fs.mkdir = originalMkdir;
  }
});

test('workspace refuses a missing project identity and does not create it for control center', async (t) => {
  const fixture = await makeBrandRuntimeFixture(t);
  const missingBusinessProjectId = '20260729-999-missing-brand-project';
  await assert.rejects(
    createBrandProjectWorkspace({
      projectRoot: fixture.projectRoot,
      enterpriseId: fixture.enterpriseId,
      businessProjectId: missingBusinessProjectId,
      taskId: fixture.taskId,
    }),
    /project does not exist/u,
  );
  await assert.rejects(
    fs.access(path.join(
      fixture.projectRoot,
      'business-projects',
      fixture.enterpriseId,
      missingBusinessProjectId,
    )),
    /ENOENT/u,
  );
});

test('workspace parses project.json and rejects invalid or mismatched project identity', async (t) => {
  const fixture = await makeBrandRuntimeFixture(t);
  const request = {
    projectRoot: fixture.projectRoot,
    ...fixture.identity,
  };

  await fs.writeFile(fixture.projectFile, '{}\n', 'utf8');
  await assert.rejects(
    createBrandProjectWorkspace(request),
    /project identity schemaVersion must be 1/u,
  );

  await fs.writeFile(fixture.projectFile, '{"schemaVersion":', 'utf8');
  await assert.rejects(
    createBrandProjectWorkspace(request),
    /project identity JSON is invalid/u,
  );

  await fs.writeFile(
    fixture.projectFile,
    `${JSON.stringify({
      ...fixture.projectRecord,
      enterpriseId: 'enterprise-999',
    })}\n`,
    'utf8',
  );
  await assert.rejects(
    createBrandProjectWorkspace(request),
    /project identity enterpriseId does not match request/u,
  );

  await fs.writeFile(
    fixture.projectFile,
    `${JSON.stringify({
      ...fixture.projectRecord,
      businessProjectId: '20260729-999-other-project',
    })}\n`,
    'utf8',
  );
  await assert.rejects(
    createBrandProjectWorkspace(request),
    /project identity businessProjectId does not match request/u,
  );
});

test('workspace refuses task traversal before creating organization directories', async (t) => {
  const fixture = await makeBrandRuntimeFixture(t);
  for (const taskId of ['../escape', '..', '.', 'nested/task', String.raw`nested\task`]) {
    await assert.rejects(
      createBrandProjectWorkspace({
        projectRoot: fixture.projectRoot,
        enterpriseId: fixture.enterpriseId,
        businessProjectId: fixture.businessProjectId,
        taskId,
      }),
      /taskId/u,
    );
  }
  await assert.rejects(
    fs.access(path.join(fixture.projectDirectory, 'organizations')),
    /ENOENT/u,
  );
});

test('workspace refuses unsafe enterprise and business project ids', async (t) => {
  const fixture = await makeBrandRuntimeFixture(t);
  for (const [field, value] of [
    ['enterpriseId', '../enterprise'],
    ['enterpriseId', 'Enterprise-001'],
    ['businessProjectId', '../project'],
    ['businessProjectId', 'project-001'],
    ['businessProjectId', '20260729-001-../escape'],
  ]) {
    await assert.rejects(
      createBrandProjectWorkspace({
        projectRoot: fixture.projectRoot,
        ...fixture.identity,
        [field]: value,
      }),
      new RegExp(field, 'u'),
    );
  }
});

test('workspace rejects a project directory redirected by a symbolic link', async (t) => {
  const fixture = await makeBrandRuntimeFixture(t);
  const externalRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'brand-project-external-'));
  t.after(() => fs.rm(externalRoot, { recursive: true, force: true }));
  await fs.writeFile(path.join(externalRoot, 'project.json'), '{}\n', 'utf8');
  await fs.rm(fixture.projectDirectory, { recursive: true });
  try {
    await fs.symlink(externalRoot, fixture.projectDirectory, 'junction');
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      t.skip(`symbolic links unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  await assert.rejects(
    createBrandProjectWorkspace({
      projectRoot: fixture.projectRoot,
      ...fixture.identity,
    }),
    /symbolic link|project boundary/u,
  );
  await assert.rejects(
    fs.access(path.join(externalRoot, 'organizations')),
    /ENOENT/u,
  );
});

test('workspace rejects a pre-existing task symlink that escapes its task root', async (t) => {
  const fixture = await makeBrandRuntimeFixture(t);
  const organizationRoot = path.join(
    fixture.projectDirectory,
    'organizations',
    'ai-brand-officer',
  );
  const tasksRoot = path.join(organizationRoot, 'tasks');
  const externalTask = await fs.mkdtemp(path.join(os.tmpdir(), 'brand-task-external-'));
  t.after(() => fs.rm(externalTask, { recursive: true, force: true }));
  await fs.mkdir(tasksRoot, { recursive: true });
  try {
    await fs.symlink(externalTask, path.join(tasksRoot, fixture.taskId), 'junction');
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      t.skip(`symbolic links unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  await assert.rejects(
    createBrandProjectWorkspace({
      projectRoot: fixture.projectRoot,
      ...fixture.identity,
    }),
    /symbolic link|task boundary/u,
  );
  assert.deepEqual(await fs.readdir(externalTask), []);
});

test('workspace rejects an organization parent chain replaced by an external symlink', async (t) => {
  const fixture = await makeBrandRuntimeFixture(t);
  const request = {
    projectRoot: fixture.projectRoot,
    ...fixture.identity,
  };
  const initial = await createBrandProjectWorkspace(request);
  const organizationsRoot = path.dirname(initial.organizationRoot);
  const displacedRoot = `${organizationsRoot}-displaced`;
  const externalRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'brand-organization-parent-external-'),
  );
  t.after(() => fs.rm(externalRoot, { recursive: true, force: true }));
  await fs.rename(organizationsRoot, displacedRoot);
  t.after(() => fs.rm(displacedRoot, { recursive: true, force: true }));
  try {
    await fs.symlink(externalRoot, organizationsRoot, 'junction');
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      t.skip(`symbolic links unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  await assert.rejects(
    createBrandProjectWorkspace(request),
    /symbolic link|project boundary|organization boundary/u,
  );
  assert.deepEqual(await fs.readdir(externalRoot), []);
});
