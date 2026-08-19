import { RequestMethod, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { ModulesContainer } from '@nestjs/core/injector/modules-container';
import { z, type ZodTypeAny } from 'zod';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as contracts from '@dataroom/contracts';
import {
  API_BASE,
  AddRecipientsBody,
  CreateDataRoomBody,
  CreateFolderBody,
  CreateShareBody,
  GoogleAuthQuery,
  InitUploadBody,
  ListChildrenQuery,
  MoveNodeBody,
  PaginationQuery,
  RenameNodeBody,
  UpdateDataRoomBody,
  endpoints,
} from '@dataroom/contracts';
import { encodeState, returnToFromState } from '../../src/auth/return-to';
import { ZodValidationPipe, validate } from '../../src/common/zod-validation.pipe';
import { createTestHarness, httpServer, type TestHarness } from '../support/app';

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

interface RequestSchemaExpectation {
  exportName: string;
  kind: RequestParameter['kind'];
  schema: ZodTypeAny;
}

interface SchemaClassification {
  name: string;
  schema: ZodTypeAny;
  usage: 'route request' | 'composition only' | 'outside-route validation' | 'not a request';
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
const CONTRACT_REQUEST_SCHEMAS: Record<string, RequestSchemaExpectation> = {
  'GET /api/v1/nodes/:id/children': {
    exportName: 'ListChildrenQuery',
    kind: 'query',
    schema: ListChildrenQuery,
  },
  'PATCH /api/v1/data-rooms/:id': {
    exportName: 'UpdateDataRoomBody',
    kind: 'body',
    schema: UpdateDataRoomBody,
  },
  'PATCH /api/v1/nodes/:id': {
    exportName: 'RenameNodeBody',
    kind: 'body',
    schema: RenameNodeBody,
  },
  'POST /api/v1/data-rooms': {
    exportName: 'CreateDataRoomBody',
    kind: 'body',
    schema: CreateDataRoomBody,
  },
  'POST /api/v1/folders': {
    exportName: 'CreateFolderBody',
    kind: 'body',
    schema: CreateFolderBody,
  },
  'POST /api/v1/nodes/:id/move': {
    exportName: 'MoveNodeBody',
    kind: 'body',
    schema: MoveNodeBody,
  },
  'POST /api/v1/nodes/:id/shares': {
    exportName: 'CreateShareBody',
    kind: 'body',
    schema: CreateShareBody,
  },
  'POST /api/v1/shares/:id/recipients': {
    exportName: 'AddRecipientsBody',
    kind: 'body',
    schema: AddRecipientsBody,
  },
  'POST /api/v1/uploads/init': {
    exportName: 'InitUploadBody',
    kind: 'body',
    schema: InitUploadBody,
  },
};

/**
 * Request schemas the frozen package exports that no route parameter validates. These are typed
 * references rather than explanatory strings so the inventory can prove identity and exclusive
 * classification mechanically.
 *
 * QA found the hole: a frozen schema absent from both the map and the controllers is invisible to
 * every assertion in this file. Deleting `GoogleStartGuard`'s `safeParse` would have left the suite
 * green. The checks below now exercise both actual OAuth parsing sites through the exact frozen
 * object, rather than treating a name and comment as proof.
 */
const COMPOSITION_ONLY_REQUEST_SCHEMAS = {
  // `PaginationQuery.extend(...)` copies these exact field schema objects into the concrete query.
  PaginationQuery: { schema: PaginationQuery, composedInto: ListChildrenQuery },
};

const SCHEMAS_VALIDATED_OUTSIDE_A_ROUTE_PARAMETER = {
  // The OAuth start and callback read their query through Passport, not through a pipe:
  // `GoogleStartGuard.validatedReturnTo` and `returnToFromState` both parse it with this schema.
  // `test/integration/auth.test.ts` covers the open-redirect cases it exists to stop.
  GoogleAuthQuery: { schema: GoogleAuthQuery },
};

/**
 * Every exported Zod schema that is not an inbound request schema. This deliberately names every
 * export instead of guessing from suffixes: adding `StartOAuthInput`, or any other newly named Zod
 * schema, leaves it unclassified and fails the inventory test.
 */
const NON_REQUEST_SCHEMA_EXPORTS: Record<string, ZodTypeAny> = {
  AccessLevel: contracts.AccessLevel,
  AllowedMimeType: contracts.AllowedMimeType,
  ApiError: contracts.ApiError,
  BreadcrumbDto: contracts.BreadcrumbDto,
  CompleteUploadResponse: contracts.CompleteUploadResponse,
  Cursor: contracts.Cursor,
  DataRoomDto: contracts.DataRoomDto,
  DeletePreviewDto: contracts.DeletePreviewDto,
  Email: contracts.Email,
  ErrorCode: contracts.ErrorCode,
  InitUploadResponse: contracts.InitUploadResponse,
  IsoDateTime: contracts.IsoDateTime,
  ListChildrenResponse: contracts.ListChildrenResponse,
  ListDataRoomsResponse: contracts.ListDataRoomsResponse,
  ListSharesResponse: contracts.ListSharesResponse,
  MeResponse: contracts.MeResponse,
  NodeDetailResponse: contracts.NodeDetailResponse,
  NodeDto: contracts.NodeDto,
  NodeListItem: contracts.NodeListItem,
  NodeSortField: contracts.NodeSortField,
  NodeStatsDto: contracts.NodeStatsDto,
  NodeType: contracts.NodeType,
  RefreshResponse: contracts.RefreshResponse,
  ResolveShareResponse: contracts.ResolveShareResponse,
  ResourceName: contracts.ResourceName,
  RetryUploadResponse: contracts.RetryUploadResponse,
  SessionDto: contracts.SessionDto,
  ShareDto: contracts.ShareDto,
  ShareRecipientDto: contracts.ShareRecipientDto,
  ShareRole: contracts.ShareRole,
  ShareType: contracts.ShareType,
  UploadStatus: contracts.UploadStatus,
  UserDto: contracts.UserDto,
  Uuid: contracts.Uuid,
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

const isZodSchema = (value: unknown): value is ZodTypeAny =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { safeParse?: unknown }).safeParse === 'function';

const schemaClassifications = (): SchemaClassification[] => [
  ...Object.entries(NON_REQUEST_SCHEMA_EXPORTS).map(([name, schema]) => ({
    name,
    schema,
    usage: 'not a request' as const,
  })),
  ...Object.values(CONTRACT_REQUEST_SCHEMAS).map(({ exportName: name, schema }) => ({
    name,
    schema,
    usage: 'route request' as const,
  })),
  ...Object.entries(COMPOSITION_ONLY_REQUEST_SCHEMAS).map(([name, { schema }]) => ({
    name,
    schema,
    usage: 'composition only' as const,
  })),
  ...Object.entries(SCHEMAS_VALIDATED_OUTSIDE_A_ROUTE_PARAMETER).map(([name, { schema }]) => ({
    name,
    schema,
    usage: 'outside-route validation' as const,
  })),
];

const schemaExportViolations = (
  exports: Record<string, unknown>,
  classifications: SchemaClassification[],
): string[] => {
  const violations: string[] = [];
  const exported = new Map(Object.entries(exports).filter(([, value]) => isZodSchema(value)));
  const classificationsByName = new Map<string, SchemaClassification[]>();

  for (const classification of classifications) {
    const sameName = classificationsByName.get(classification.name) ?? [];
    sameName.push(classification);
    classificationsByName.set(classification.name, sameName);
  }

  for (const [name, schema] of exported) {
    const matching = classificationsByName.get(name) ?? [];
    if (matching.length === 0) {
      violations.push(`${name} — exported Zod schema is not explicitly classified`);
    } else if (matching.length !== 1) {
      violations.push(
        `${name} — exported Zod schema must have exactly one classification, found ${matching.length}: ${matching.map(({ usage }) => usage).join(', ')}`,
      );
    } else if (matching[0]?.schema !== schema) {
      violations.push(`${name} — classification does not reference the exact exported schema`);
    }
  }
  for (const name of classificationsByName.keys()) {
    if (!exported.has(name)) violations.push(`${name} — classified Zod schema is not exported`);
  }

  return violations.sort();
};

const compositionViolations = (
  compositions: Record<
    string,
    { schema: z.AnyZodObject; composedInto: z.AnyZodObject }
  > = COMPOSITION_ONLY_REQUEST_SCHEMAS,
): string[] => {
  const violations: string[] = [];

  for (const [name, { schema, composedInto }] of Object.entries(compositions)) {
    for (const [field, fieldSchema] of Object.entries(schema.shape)) {
      if (composedInto.shape[field] !== fieldSchema) {
        violations.push(
          `${name}.${field} — composition target does not reuse the exact frozen field schema`,
        );
      }
    }
  }

  return violations.sort();
};

/**
 * Every way a route's request validation can disagree with the contract, as a list of readable
 * strings. A function rather than a chain of `expect`s so the mutation test below can run the very
 * same check over deliberately corrupted input and prove it reports the corruption.
 */
const schemaViolations = (
  parameters: RequestParameter[],
  expected: Record<string, RequestSchemaExpectation>,
): string[] => {
  const violations: string[] = [];
  const parametersByRoute = new Map<string, RequestParameter[]>();

  for (const parameter of parameters) {
    const routeParameters = parametersByRoute.get(parameter.route) ?? [];
    routeParameters.push(parameter);
    parametersByRoute.set(parameter.route, routeParameters);
  }

  for (const [route, routeParameters] of parametersByRoute) {
    if (expected[route] !== undefined) continue;
    for (const parameter of routeParameters) {
      violations.push(
        `${route} — ${parameter.kind} parameter ${parameter.index} — accepts a payload no endpoint contract schema covers`,
      );
    }
  }

  for (const [route, expectation] of Object.entries(expected)) {
    const routeParameters = parametersByRoute.get(route) ?? [];
    if (routeParameters.length !== 1) {
      violations.push(
        `${route} — expected exactly one ${expectation.kind} parameter, found ${routeParameters.length}`,
      );
      continue;
    }

    const parameter = routeParameters[0] as RequestParameter;
    const label = `${route} — ${parameter.kind} parameter ${parameter.index}`;

    if (parameter.kind !== expectation.kind) {
      violations.push(`${label} — expected a ${expectation.kind} parameter`);
      continue;
    }

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
    if (attached !== expectation.schema) {
      violations.push(`${label} — validates with a schema that is not the frozen contract schema`);
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

  it('accounts for every request schema the frozen contract exports', () => {
    expect(schemaExportViolations(contracts, schemaClassifications())).toEqual([]);
  });

  it('keeps PaginationQuery composition-only and reuses its exact frozen fields', () => {
    expect(compositionViolations()).toEqual([]);
  });

  it('uses the exact GoogleAuthQuery export at both outside-route validation sites', async () => {
    const safeParse = vi.spyOn(GoogleAuthQuery, 'safeParse');

    try {
      await request(httpServer(harness))
        .get(`${API_BASE}${endpoints.auth.googleStart.path}`)
        .query({ returnTo: '/rooms/outbound' })
        .expect(200);
      expect(returnToFromState(encodeState('/rooms/returned', 'test-nonce'))).toBe(
        '/rooms/returned',
      );

      expect(safeParse.mock.calls.map(([input]) => input)).toEqual([
        { returnTo: '/rooms/outbound' },
        { returnTo: '/rooms/returned' },
      ]);
    } finally {
      safeParse.mockRestore();
    }
  });

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

  it('declares exactly one correctly typed request parameter with its frozen schema per route', () => {
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
        'POST /api/v1/uploads/init — expected exactly one body parameter, found 0',
      ]);
    });

    it('fails when a route changes its request parameter from body to query', () => {
      const mutated = requestParameters().map((parameter) =>
        parameter.route === 'POST /api/v1/folders'
          ? { ...parameter, kind: 'query' as const }
          : parameter,
      );

      expect(schemaViolations(mutated, CONTRACT_REQUEST_SCHEMAS)).toEqual([
        'POST /api/v1/folders — query parameter 0 — expected a body parameter',
      ]);
    });

    it('fails when a route declares the request payload more than once', () => {
      const parameters = requestParameters();
      const original = parameters.find((parameter) => parameter.route === 'POST /api/v1/folders');
      expect(original).toBeDefined();
      const mutated = [...parameters, { ...(original as RequestParameter), index: 1 }];

      expect(schemaViolations(mutated, CONTRACT_REQUEST_SCHEMAS)).toEqual([
        'POST /api/v1/folders — expected exactly one body parameter, found 2',
      ]);
    });

    it('does not let a newly exported Zod request hide behind an unconventional name', () => {
      const mutatedExports = {
        ...contracts,
        StartOAuthInput: z.object({ returnTo: z.string().optional() }).strict(),
      };

      expect(schemaExportViolations(mutatedExports, schemaClassifications())).toEqual([
        'StartOAuthInput — exported Zod schema is not explicitly classified',
      ]);
    });

    it('fails when an outside-route exception points at a local schema copy', () => {
      const mutated = schemaClassifications().map((classification) =>
        classification.name === 'GoogleAuthQuery'
          ? { ...classification, schema: GoogleAuthQuery.extend({}) }
          : classification,
      );

      expect(schemaExportViolations(contracts, mutated)).toEqual([
        'GoogleAuthQuery — classification does not reference the exact exported schema',
      ]);
    });

    it('fails when a composition-only schema is also classified as a route request', () => {
      const mutated = [
        ...schemaClassifications(),
        { name: 'PaginationQuery', schema: PaginationQuery, usage: 'route request' as const },
      ];

      expect(schemaExportViolations(contracts, mutated)).toEqual([
        'PaginationQuery — exported Zod schema must have exactly one classification, found 2: composition only, route request',
      ]);
    });

    it('fails when PaginationQuery composition replaces a frozen field with a local copy', () => {
      const copiedLimit = z.coerce.number().int().min(1).max(100).default(50);
      const mutatedTarget = ListChildrenQuery.extend({ limit: copiedLimit });

      expect(
        compositionViolations({
          PaginationQuery: { schema: PaginationQuery, composedInto: mutatedTarget },
        }),
      ).toEqual([
        'PaginationQuery.limit — composition target does not reuse the exact frozen field schema',
      ]);
    });
  });
});
