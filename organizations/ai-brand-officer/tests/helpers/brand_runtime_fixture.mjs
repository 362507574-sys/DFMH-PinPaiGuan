import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const FIXED_NOW = '2026-07-29T00:00:00.000Z';

const FIXED_IDENTITY = Object.freeze({
  enterpriseId: 'enterprise-001',
  businessProjectId: '20260729-001-brand-runtime',
  taskId: 'brand-task-001',
});

export async function makeBrandRuntimeFixture(t) {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ai-brand-officer-runtime-'),
  );
  const projectDirectory = path.join(
    projectRoot,
    'business-projects',
    FIXED_IDENTITY.enterpriseId,
    FIXED_IDENTITY.businessProjectId,
  );
  const projectFile = path.join(projectDirectory, 'project.json');
  const projectRecord = Object.freeze({
    schemaVersion: 1,
    enterpriseId: FIXED_IDENTITY.enterpriseId,
    enterpriseDisplayName: '测试企业',
    enterpriseIdentityStatus: 'resolved',
    businessProjectId: FIXED_IDENTITY.businessProjectId,
    displayName: 'AI品牌官运行时测试项目',
    objective: '验证品牌官项目工作区的严格隔离和契约。',
    scope: '仅用于系统临时目录中的自动化测试，不产生正式业务成果。',
    primaryOrganizationId: 'ai-brand-officer',
    collaboratingOrganizationIds: [],
    publicSkillIds: [],
    status: 'active',
    contextVersion: 1,
    sourceMessageId: 'message-001',
    commanderTaskId: 'commander-task-001',
    feishuChatId: '',
    codexThreadId: '',
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    completedAt: '',
    cancelledAt: '',
    archivedAt: '',
  });
  await fs.mkdir(projectDirectory, { recursive: true });
  await fs.writeFile(
    projectFile,
    `${JSON.stringify(projectRecord, null, 2)}\n`,
    'utf8',
  );

  const cleanup = async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  };
  if (t && typeof t.after === 'function') t.after(cleanup);

  return Object.freeze({
    projectRoot,
    projectDirectory,
    projectFile,
    projectRecord,
    fixedNow: FIXED_NOW,
    identity: FIXED_IDENTITY,
    ...FIXED_IDENTITY,
    cleanup,
  });
}
