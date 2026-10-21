import { RequestMethod } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { THROTTLER_LIMIT, THROTTLER_SKIP } from '@nestjs/throttler/dist/throttler.constants';
import { AppModule } from '../src/app.module';
import {
  ANY_PERMISSION_KEY,
  AUTHENTICATED_KEY,
  IS_PUBLIC_KEY,
  PERMISSIONS_KEY,
} from '../src/common/decorators';
import { MemoryStorage } from './helpers';
import { StorageService } from '../src/storage/storage.service';

export interface RouteInfo {
  method: string;
  path: string;
  /** public | authenticated | all:<perms> | any:<perms> | NONE */
  access: string;
  /** Request inputs (body, query, params) and whether each one passes through a validation pipe. */
  inputs: { kind: string; name: string; validated: boolean }[];
  /** default | login | skip */
  rateLimit: string;
}

const INPUT_KINDS: Partial<Record<number, string>> = {
  [RouteParamtypes.BODY]: 'body',
  [RouteParamtypes.QUERY]: 'query',
  [RouteParamtypes.PARAM]: 'param',
  [RouteParamtypes.FILE]: 'file',
};

/** Reads every controller route of the application with its security metadata (no HTTP server). */
export async function collectRoutes(): Promise<RouteInfo[]> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule, DiscoveryModule] })
    .overrideProvider(StorageService)
    .useValue(new MemoryStorage())
    .compile();
  const discovery = moduleRef.get(DiscoveryService);
  const scanner = moduleRef.get(MetadataScanner);
  const reflector = moduleRef.get(Reflector);
  const routes: RouteInfo[] = [];

  for (const wrapper of discovery.getControllers()) {
    const metatype = wrapper.metatype as object;
    const proto = Object.getPrototypeOf(wrapper.instance as object);
    const base = Reflect.getMetadata(PATH_METADATA, metatype) as string;
    for (const name of scanner.getAllMethodNames(proto)) {
      const handler = proto[name];
      const path = Reflect.getMetadata(PATH_METADATA, handler);
      if (path === undefined) continue;
      const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
      const targets = [handler, metatype];
      const all = reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, targets);
      const any = reflector.getAllAndOverride<string[] | undefined>(ANY_PERMISSION_KEY, targets);
      const access = reflector.getAllAndOverride(IS_PUBLIC_KEY, targets)
        ? 'public'
        : all
          ? `all:${all.join(',')}`
          : any
            ? `any:${any.join(',')}`
            : reflector.getAllAndOverride(AUTHENTICATED_KEY, targets)
              ? 'authenticated'
              : 'NONE';

      const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, metatype, name) ?? {}) as Record<
        string,
        { index: number; data?: unknown; pipes?: unknown[] }
      >;
      const inputs = Object.entries(args)
        .map(([key, arg]) => ({ type: Number(key.split(':')[0]), arg }))
        .filter(({ type }) => INPUT_KINDS[type] !== undefined)
        .map(({ type, arg }) => ({
          kind: INPUT_KINDS[type]!,
          name: typeof arg.data === 'string' ? arg.data : '*',
          validated: (arg.pipes?.length ?? 0) > 0,
        }))
        .sort((a, b) => `${a.kind}${a.name}`.localeCompare(`${b.kind}${b.name}`));

      const skip = Reflect.getMetadata(`${THROTTLER_SKIP}default`, handler) as boolean | undefined;
      const limit = Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler) as number | undefined;
      routes.push({
        method,
        path: '/' + [base, path].filter((x) => x && x !== '/').join('/'),
        access,
        inputs,
        rateLimit: skip ? 'skip' : limit !== undefined ? 'login' : 'default',
      });
    }
  }
  await moduleRef.close();
  return routes.sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
}

const ACCESS_LABEL = (access: string) =>
  access.startsWith('all:')
    ? access
        .slice(4)
        .split(',')
        .map((p) => `\`${p}\``)
        .join(' + ')
    : access.startsWith('any:')
      ? 'any of ' +
        access
          .slice(4)
          .split(',')
          .map((p) => `\`${p}\``)
          .join(', ')
      : access === 'public'
        ? '**public**'
        : access;

/** The endpoint table of docs/SECURITY.md (kept in sync by route-security.e2e-spec.ts). */
export function routeTable(routes: RouteInfo[]): string {
  const lines = [
    '| Method | Path (under `/api/v1`) | Access (server guard) | Validated input | Rate limit |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const r of routes) {
    const inputs = r.inputs.length
      ? r.inputs.map((i) => (i.name === '*' ? i.kind : `${i.kind} \`${i.name}\``)).join(', ')
      : '—';
    lines.push(
      `| ${r.method} | \`${r.path}\` | ${ACCESS_LABEL(r.access)} | ${inputs} | ${r.rateLimit} |`,
    );
  }
  return lines.join('\n');
}
