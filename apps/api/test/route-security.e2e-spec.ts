import { RequestMethod } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AppModule } from '../src/app.module';
import {
  ANY_PERMISSION_KEY,
  AUTHENTICATED_KEY,
  IS_PUBLIC_KEY,
  PERMISSIONS_KEY,
} from '../src/common/decorators';
import { MemoryStorage } from './helpers';
import { StorageService } from '../src/storage/storage.service';

/** Every route must explicitly declare who may call it (deny-by-default guard). */
describe('Route security declarations', () => {
  it('every controller method declares Public, permissions or Authenticated', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, DiscoveryModule] })
      .overrideProvider(StorageService)
      .useValue(new MemoryStorage())
      .compile();
    const discovery = moduleRef.get(DiscoveryService);
    const scanner = moduleRef.get(MetadataScanner);
    const reflector = moduleRef.get(Reflector);
    const routes: { route: string; access: string }[] = [];

    for (const wrapper of discovery.getControllers()) {
      const instance = wrapper.instance as object;
      const proto = Object.getPrototypeOf(instance);
      const base = Reflect.getMetadata(PATH_METADATA, wrapper.metatype as object) as string;
      for (const name of scanner.getAllMethodNames(proto)) {
        const handler = proto[name];
        const path = Reflect.getMetadata(PATH_METADATA, handler);
        if (path === undefined) continue;
        const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
        const targets = [handler, wrapper.metatype as object];
        const access = reflector.getAllAndOverride(IS_PUBLIC_KEY, targets)
          ? 'public'
          : reflector.getAllAndOverride(PERMISSIONS_KEY, targets)
            ? 'permissions'
            : reflector.getAllAndOverride(ANY_PERMISSION_KEY, targets)
              ? 'any-permission'
              : reflector.getAllAndOverride(AUTHENTICATED_KEY, targets)
                ? 'authenticated'
                : 'NONE';
        routes.push({ route: `${method} /${[base, path].filter((x) => x && x !== '/').join('/')}`, access });
      }
    }
    expect(routes.length).toBeGreaterThan(40);
    expect(routes.filter((r) => r.access === 'NONE')).toEqual([]);
    const publicRoutes = routes.filter((r) => r.access === 'public').map((r) => r.route).sort();
    expect(publicRoutes).toEqual([
      'GET /auth/csrf',
      'GET /health',
      'GET /settings/logo',
      'GET /settings/public',
      'POST /auth/login',
      'POST /auth/logout',
      'POST /auth/refresh',
    ]);
    await moduleRef.close();
  });
});
