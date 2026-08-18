import { RequestMethod, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { ModulesContainer } from '@nestjs/core/injector/modules-container';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_BASE, endpoints } from '@dataroom/contracts';
import { ZodValidationPipe } from '../../src/common/zod-validation.pipe';
import { createTestHarness, type TestHarness } from '../support/app';

interface RouteArgument {
  index: number;
  data?: string;
  pipes?: unknown[];
}

interface ControllerRoute {
  controller: Type<unknown>;
  handlerName: string;
  signature: string;
}

const signature = (method: string, path: string): string => `${method.toUpperCase()} ${path}`;

const joinPath = (...parts: Array<string | undefined>): string => {
  const joined = parts
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
  return joined.startsWith('/') ? joined : `/${joined}`;
};

const pathsOf = (metadata: unknown): string[] =>
  Array.isArray(metadata) ? (metadata as string[]) : typeof metadata === 'string' ? [metadata] : [];

describe('contract — registered routes', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  const expectedContractRoutes = (): string[] =>
    Object.values(endpoints)
      .flatMap((group) => Object.values(group))
      .map((endpoint) => signature(endpoint.method, `${API_BASE}${endpoint.path}`))
      .sort();

  const controllerRoutes = (): ControllerRoute[] => {
    const modules = harness.app.get(ModulesContainer);
    const routes: ControllerRoute[] = [];

    for (const moduleRef of modules.values()) {
      for (const wrapper of moduleRef.controllers.values()) {
        const controller = wrapper.metatype;
        if (typeof controller !== 'function') continue;
        const controllerType = controller as Type<unknown>;
        const controllerPaths = pathsOf(Reflect.getMetadata(PATH_METADATA, controllerType));
        const prototype = controllerType.prototype as Record<string, unknown>;

        for (const handlerName of Object.getOwnPropertyNames(prototype)) {
          if (handlerName === 'constructor') continue;
          const handler = prototype[handlerName];
          if (typeof handler !== 'function') continue;
          const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
          const handlerPaths = pathsOf(Reflect.getMetadata(PATH_METADATA, handler));
          if (method === undefined || handlerPaths.length === 0) continue;

          for (const controllerPath of controllerPaths.length === 0 ? [''] : controllerPaths) {
            for (const handlerPath of handlerPaths) {
              routes.push({
                controller: controllerType,
                handlerName,
                signature: signature(
                  RequestMethod[method],
                  joinPath(API_BASE, controllerPath, handlerPath),
                ),
              });
            }
          }
        }
      }
    }
    return routes;
  };

  it('registers exactly the endpoint contract plus the operational health probe', () => {
    const registered = controllerRoutes()
      .map((route) => route.signature)
      .sort();
    const health = signature('GET', `${API_BASE}/health`);

    // Health is an infrastructure probe introduced by W0-6, not an application endpoint consumed
    // by either client. Keep the exception explicit so a second undocumented route cannot hide
    // behind a broad prefix filter.
    expect(registered.filter((route) => route === health)).toEqual([health]);
    expect(registered.filter((route) => route !== health)).toEqual(expectedContractRoutes());
  });

  it('attaches a Zod schema to every declared body and query parameter', () => {
    const requestArguments: Array<{ route: string; argument: RouteArgument }> = [];

    for (const route of controllerRoutes()) {
      const metadata = (Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        route.controller,
        route.handlerName,
      ) ?? {}) as Record<string, RouteArgument>;

      for (const [key, argument] of Object.entries(metadata)) {
        const kind = Number(key.split(':')[0]);
        if (kind === RouteParamtypes.BODY || kind === RouteParamtypes.QUERY) {
          requestArguments.push({ route: route.signature, argument });
        }
      }
    }

    expect(requestArguments.map(({ route }) => route).sort()).toEqual(
      [
        'GET /api/v1/nodes/:id/children',
        'PATCH /api/v1/data-rooms/:id',
        'PATCH /api/v1/nodes/:id',
        'POST /api/v1/data-rooms',
        'POST /api/v1/folders',
        'POST /api/v1/nodes/:id/move',
        'POST /api/v1/nodes/:id/shares',
        'POST /api/v1/shares/:id/recipients',
        'POST /api/v1/uploads/init',
      ].sort(),
    );

    for (const { route, argument } of requestArguments) {
      expect(
        argument.pipes?.some((pipe) => pipe instanceof ZodValidationPipe),
        `${route} parameter ${argument.index} must use a ZodValidationPipe`,
      ).toBe(true);
    }
  });
});
