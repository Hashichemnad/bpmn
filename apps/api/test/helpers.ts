import './test-env';
import { Test } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { type NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';
import { CSRF_HEADER, type SystemRoleKey } from '@processhub/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';
import { hashPassword } from '../src/auth/argon';
import { syncRolesAndPermissions } from '../prisma/seed';
import { Readable } from 'node:stream';

export const PASSWORD = 'Test-Password1';

/** In-memory replacement for MinIO. */
export class MemoryStorage {
  files = new Map<string, { data: Buffer; contentType: string }>();
  async put(key: string, data: Buffer, contentType: string) {
    this.files.set(key, { data, contentType });
  }
  async get(key: string) {
    const f = this.files.get(key);
    if (!f) throw new Error('missing');
    return Readable.from(f.data);
  }
  async remove(key: string) {
    this.files.delete(key);
  }
}

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  storage: MemoryStorage;
}

export async function createApp(): Promise<TestContext> {
  const storage = new MemoryStorage();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(StorageService)
    .useValue(storage)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: false,
  });
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService), storage };
}

const TABLES = [
  'AuditLog',
  'ObjectLink',
  'ProcessVersion',
  'ProcessModel',
  'Process',
  'RepoObject',
  'RefreshToken',
  'UserRole',
  'User',
  'Department',
  'Setting',
  'RolePermission',
  'Role',
  'Permission',
];

/** Empties every table and re-creates the system roles. */
export async function resetDb(prisma: PrismaService) {
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} CASCADE`);
  await syncRolesAndPermissions(prisma);
}

let passwordHash: string | undefined;

export async function createUser(
  prisma: PrismaService,
  email: string,
  roles: SystemRoleKey[],
  extra: { status?: 'ACTIVE' | 'INACTIVE'; nameEn?: string } = {},
) {
  passwordHash ??= await hashPassword(PASSWORD);
  const roleRows = await prisma.role.findMany({ where: { key: { in: roles } } });
  return prisma.user.create({
    data: {
      email,
      nameEn: extra.nameEn ?? email.split('@')[0],
      nameAr: 'مستخدم',
      passwordHash,
      status: extra.status ?? 'ACTIVE',
      roles: { create: roleRows.map((r) => ({ roleId: r.id })) },
    },
  });
}

/** A browser-like client: keeps cookies and echoes the CSRF token on unsafe requests. */
export class Client {
  readonly agent: TestAgent;
  csrf = '';

  constructor(app: INestApplication) {
    this.agent = request.agent(app.getHttpServer());
  }

  async init() {
    const res = await this.agent.get('/api/v1/auth/csrf').expect(200);
    this.csrf = res.body.csrfToken;
    return this;
  }

  /** Re-reads the CSRF cookie (it is rotated on login). */
  private syncCsrf(res: request.Response) {
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const c = cookies.find((v) => v.startsWith('ph_csrf='));
    if (c) this.csrf = decodeURIComponent(c.split(';')[0].split('=')[1]);
  }

  async login(email: string, password = PASSWORD) {
    if (!this.csrf) await this.init();
    const res = await this.post('/auth/login').send({ email, password });
    this.syncCsrf(res);
    return res;
  }

  get(path: string) {
    return this.agent.get(`/api/v1${path}`);
  }
  post(path: string) {
    return this.agent.post(`/api/v1${path}`).set(CSRF_HEADER, this.csrf);
  }
  put(path: string) {
    return this.agent.put(`/api/v1${path}`).set(CSRF_HEADER, this.csrf);
  }
  patch(path: string) {
    return this.agent.patch(`/api/v1${path}`).set(CSRF_HEADER, this.csrf);
  }
  delete(path: string) {
    return this.agent.delete(`/api/v1${path}`).set(CSRF_HEADER, this.csrf);
  }
}

export async function loggedIn(app: INestApplication, email: string, password = PASSWORD) {
  const c = await new Client(app).init();
  const res = await c.login(email, password);
  if (res.status !== 200)
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return c;
}

export function sampleBpmn(ids: string[] = ['Task_1']): string {
  const tasks = ids.map((id) => `<bpmn:task id="${id}" name="${id}" />`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs_1"><bpmn:process id="Process_1">${tasks}</bpmn:process></bpmn:definitions>`;
}
