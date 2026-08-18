import { RequestMethod, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { ModulesContainer } from '@nestjs/core/injector/modules-container';
import { z, type ZodTypeAny } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API_BASE,
  AddRecipientsBody,
  CreateDataRoomBody,
  CreateFolderBody,
  CreateShareBody,
  InitUploadBody,
  ListChildrenQuery,
  MoveNodeBody,
  RenameNodeBody,
  UpdateDataRoomBody,
  endpoints,
} from '@dataroom/contracts';
import { ZodValidationPipe, validate } from '../../src/common/zod-validation.pipe';
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

/** One declared `@Body()` / `@Query()` parameter, flattened out of Nest's route-args metadata. */
interface RequestParameter {
  route: string;
  kind: 'body' | 'query';
  index: number;
  /** Set by `@Body('field')` — validating one property rather than the whole payload. */
  data?: string | undefined;
  pipes: unknown[];
}

/**
 * Route signature → the **exact** frozen request schema that route must validate with.
 *
 * Every value here is imported from `@dataroom/contracts` and compared by reference, not by shape.
 * Both of those choices are load-bearing:
 *
 * - Wave 7 QA found that asserting "this parameter has *a* `ZodValidationPipe`" proves nothing.
 *   `UploadsController.init` satisfied it while validating against a widened local copy of
 *   `InitUploadBody`, so a request the frozen contract rejects was accepted by the running API and
 *   no test noticed. Any route could have done the same.
 * - Shape comparison would not have helped either: `CreateDataRoomBody`, `UpdateDataRoomBody` and
 *   `RenameNodeBody` are all `z.object({ name: ResourceName }).strict()`. Three routes could
 *   validate with each other's schemas, or with a locally re-declared equivalent, and a structural
 *   check would pass every time. Reference identity is the only comparison that proves the running
 *   controller reached into the frozen package rather than into something that merely resembles it.
 */
const CONTRACT_REQUEST_SCHEMAS: Record<string, ZodTypeAny> = {
  'GET /api/v1/nodes/:id/children': ListChildrenQuery,
  'PATCH /api/v1/data-rooms/:id': UpdateDataRoomBody,
  'PATCH /api/v1/nodes/:id': RenameNodeBody,
  'POST /api/v1/data-rooms': CreateDataRoomBody,
  'POST /api/v1/folders': CreateFolderBody,
  'POST /api/v1/nodes/:id/move': MoveNodeBody,
  'POST /api/v1/nodes/:id/shares': CreateShareBody,
  'POST /api/v1/shares/:id/recipients': AddRecipientsBody,
  'POST /api/v1/uploads/init': InitUploadBody,
};

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

const isZodPipe = (pipe: unknown): pipe is ZodValidationPipe<unknown, unknown> =>
  pipe instanceof ZodValidationPipe;

/**
 * Every way a route's request validation can disagree with the contract, as a list of readable
 * strings. A function rather than a chain of `expect`s so the mutation test below can run the very
 * same check over deliberately corrupted input and prove it reports the corruption.
 */
const schemaViolations = (
  parameters: RequestParameter[],
  expected: Record<string, ZodTypeAny>,
): string[] => {
  const violations: string[] = [];
  const covered = new Set<string>();

  for (const parameter of parameters) {
    const label = `${parameter.route} — ${parameter.kind} parameter ${parameter.index}`;
    const contractSchema = expected[parameter.route];

    if (contractSchema === undefined) {
      violations.push(`${label} — accepts a payload no endpoint contract schema covers`);
      continue;
    }
    covered.add(parameter.route);

    if (parameter.data !== undefined && parameter.data !== '') {
      violations.push(`${label} — validates only "${parameter.data}", not the whole payload`);
      continue;
    }

    const zodPipes = parameter.pipes.filter(isZodPipe);
    if (zodPipes.length !== 1) {
      violations.push(
        `${label} — expected exactly one ZodValidationPipe, found ${zodPipes.length}`,
      );
      continue;
    }

    const attached: unknown = zodPipes[0]?.schema;
    if (attached !== contractSchema) {
      violations.push(`${label} — validates with a schema that is not the frozen contract schema`);
    }
  }

  for (const route of Object.keys(expected)) {
    if (!covered.has(route)) {
      violations.push(
        `${route} — has a frozen request schema but declares no body or query parameter`,
      );
    }
  }

  return violations.sort();
};

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

  /** Flattens `@Body()` / `@Query()` declarations across every registered route. */
  const requestParameters = (): RequestParameter[] => {
    const parameters: RequestParameter[] = [];

    for (const route of controllerRoutes()) {
      const metadata = (Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        route.controller,
        route.handlerName,
      ) ?? {}) as Record<string, RouteArgument>;

      for (const [key, argument] of Object.entries(metadata)) {
        const paramtype = Number(key.split(':')[0]);
        const kind =
          paramtype === RouteParamtypes.BODY
            ? 'body'
            : paramtype === RouteParamtypes.QUERY
              ? 'query'
              : undefined;
        if (kind === undefined) continue;

        parameters.push({
          route: route.signature,
          kind,
          index: argument.index,
          data: argument.data,
          pipes: argument.pipes ?? [],
        });
      }
    }

    return parameters;
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

  it('declares a body or query parameter on exactly the routes the contract gives a request schema', () => {
    const routesWithParameters = [...new Set(requestParameters().map(({ route }) => route))].sort();

    // Equality in both directions. A new route that reads `@Req().body` instead of declaring
    // `@Body()` disappears from the left side; a contract request schema nothing validates against
    // is left stranded on the right.
    expect(routesWithParameters).toEqual(Object.keys(CONTRACT_REQUEST_SCHEMAS).sort());
  });

  it('validates every body and query parameter with its exact frozen contract schema', () => {
    expect(schemaViolations(requestParameters(), CONTRACT_REQUEST_SCHEMAS)).toEqual([]);
  });

  describe('the schema check itself', () => {
    const withSubstitutedSchema = (route: string, schema: ZodTypeAny): RequestParameter[] =>
      requestParameters().map((parameter) =>
        parameter.route === route ? { ...parameter, pipes: [validate(schema)] } : parameter,
      );

    it('fails when a route validates with a different contract schema', () => {
      const mutated = withSubstitutedSchema('POST /api/v1/uploads/init', CreateFolderBody);

      expect(schemaViolations(mutated, CONTRACT_REQUEST_SCHEMAS)).toEqual([
        'POST /api/v1/uploads/init — body parameter 0 — validates with a schema that is not the frozen contract schema',
      ]);
    });

    it('fails when a route validates with a structurally identical schema from another endpoint', () => {
      // `RenameNodeBody`, `CreateDataRoomBody` and `UpdateDataRoomBody` are all
      // `z.object({ name: ResourceName }).strict()`. A shape-based comparison cannot tell them
      // apart, so a rename route validating with the data-room schema would look correct forever.
      const mutated = withSubstitutedSchema('PATCH /api/v1/nodes/:id', CreateDataRoomBody);

      expect(schemaViolations(mutated, CONTRACT_REQUEST_SCHEMAS)).toEqual([
        'PATCH /api/v1/nodes/:id — body parameter 1 — validates with a schema that is not the frozen contract schema',
      ]);
    });

    it('fails when a route validates with a widened copy of its own contract schema', () => {
      // This is the exact Wave 7 escape: `InitUploadBody.extend({ mimeType: z.string() })` is a
      // real ZodValidationPipe carrying a schema that accepts every valid body and some invalid
      // ones. Presence checks pass it; identity does not.
      const widened = InitUploadBody.extend({ mimeType: z.string().min(1) });
      const mutated = withSubstitutedSchema('POST /api/v1/uploads/init', widened);

      const initPipe = mutated.find((parameter) => parameter.route === 'POST /api/v1/uploads/init')
        ?.pipes[0];
      expect(isZodPipe(initPipe)).toBe(true);
      expect(schemaViolations(mutated, CONTRACT_REQUEST_SCHEMAS)).toEqual([
        'POST /api/v1/uploads/init — body parameter 0 — validates with a schema that is not the frozen contract schema',
      ]);
    });

    it('fails when a route drops its validation pipe entirely', () => {
      const mutated = requestParameters().map((parameter) =>
        parameter.route === 'POST /api/v1/folders' ? { ...parameter, pipes: [] } : parameter,
      );

      expect(schemaViolations(mutated, CONTRACT_REQUEST_SCHEMAS)).toEqual([
        'POST /api/v1/folders — body parameter 0 — expected exactly one ZodValidationPipe, found 0',
      ]);
    });

    it('fails when a route validates a single property instead of the whole payload', () => {
      const mutated = requestParameters().map((parameter) =>
        parameter.route === 'POST /api/v1/folders' ? { ...parameter, data: 'name' } : parameter,
      );

      expect(schemaViolations(mutated, CONTRACT_REQUEST_SCHEMAS)).toEqual([
        'POST /api/v1/folders — body parameter 0 — validates only "name", not the whole payload',
      ]);
    });

    it('fails when a contract schema is left with no route validating against it', () => {
      const mutated = requestParameters().filter(
        (parameter) => parameter.route !== 'POST /api/v1/uploads/init',
      );

      expect(schemaViolations(mutated, CONTRACT_REQUEST_SCHEMAS)).toEqual([
        'POST /api/v1/uploads/init — has a frozen request schema but declares no body or query parameter',
      ]);
    });
  });
});
