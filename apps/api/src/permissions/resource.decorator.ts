import { SetMetadata, createParamDecorator, type CustomDecorator, type ExecutionContext } from '@nestjs/common';
import type { RequestWithIdentity } from '../auth/identity';
import type { AccessGranted } from './access';

export const RESOURCE_KEY = 'dataroom:resource';

/**
 * Which route parameter names the thing being accessed, and what kind of thing it is.
 *
 * Every resource in this application resolves to a node — a data room to its root node, a share to
 * its target, an upload version to its file — so one pair of guards covers the whole API instead of
 * one guard per resource type.
 */
export type ResourceKind = 'node' | 'dataRoom' | 'share' | 'version';

export interface ResourceTarget {
  kind: ResourceKind;
  param: string;
  /** `POST /folders` and `POST /uploads/init` name their parent in the body, not in the path. */
  source: 'params' | 'body';
}

export const Resource = (
  kind: ResourceKind,
  param = 'id',
  source: 'params' | 'body' = 'params',
): CustomDecorator<string> => SetMetadata(RESOURCE_KEY, { kind, param, source });

export interface RequestWithAccess extends RequestWithIdentity {
  access?: AccessGranted;
  /** The node the guard resolved the route parameter to. */
  resolvedNodeId?: string;
}

export const CurrentAccess = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AccessGranted => {
    const request = context.switchToHttp().getRequest<RequestWithAccess>();
    if (!request.access) {
      throw new Error('No access on request — is ReadAccessGuard or OwnerGuard applied?');
    }
    return request.access;
  },
);

export const ResolvedNodeId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<RequestWithAccess>();
    if (!request.resolvedNodeId) {
      throw new Error('No resolved node on request — is ReadAccessGuard or OwnerGuard applied?');
    }
    return request.resolvedNodeId;
  },
);
