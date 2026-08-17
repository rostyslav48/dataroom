import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Uuid } from '@dataroom/contracts';
import type { Identity } from '../auth/identity';
import { errors } from '../common/domain-error';
import { accessError, type Access } from './access';
import { PermissionService } from './permission.service';
import {
  RESOURCE_KEY,
  type RequestWithAccess,
  type ResourceKind,
  type ResourceTarget,
} from './resource.decorator';

/**
 * The two guards below are the *only* place access is decided.
 *
 * No controller and no service ever writes `if (node.ownerId === user.id)`. Scattered ownership
 * checks are how data rooms leak — one endpoint added later without the check, and nobody notices
 * because there is nothing to compare it against — and they are also what would turn adding an
 * `editor` role into a rewrite instead of an enum change.
 */
abstract class AccessGuard implements CanActivate {
  protected abstract readonly requireOwner: boolean;

  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const target = this.reflector.getAllAndOverride<ResourceTarget | undefined>(RESOURCE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? { kind: 'node' as ResourceKind, param: 'id', source: 'params' as const };

    const request = context.switchToHttp().getRequest<RequestWithAccess>();
    const identity = request.identity;
    if (!identity) throw errors.unauthenticated();

    const bag = (target.source === 'body' ? request.body : request.params) as
      | Record<string, unknown>
      | undefined;
    const rawId = bag?.[target.param];

    if (typeof rawId !== 'string' || rawId.length === 0) {
      throw errors.validationFailed({ [target.param]: ['Required.'] });
    }
    // Guards run before the validation pipe, so a malformed id would otherwise become a 404 here
    // rather than the 400 it is.
    if (!Uuid.safeParse(rawId).success) {
      throw errors.validationFailed({ [target.param]: ['Must be a UUID.'] });
    }

    const access = await this.resolveAccess(target.kind, rawId, identity);
    if (!access.granted) throw accessError(access);

    if (this.requireOwner && access.role !== 'owner') {
      // A viewer asking to mutate is not told whether the item exists in some other form; they
      // already know it exists, so FORBIDDEN is both honest and non-disclosing.
      throw errors.forbidden('This item is shared with you read-only.');
    }

    request.access = access;
    request.resolvedNodeId = target.kind === 'node' ? rawId : access.shareRootId;
    return true;
  }

  /**
   * A room is deliberately *not* resolved through its root node. A recipient holding one nested
   * folder has access to the room but not to its root, so resolving through the root would deny
   * them the very entry point their share gives them.
   */
  private async resolveAccess(
    kind: ResourceKind,
    rawId: string,
    identity: Identity,
  ): Promise<Access> {
    if (kind === 'dataRoom') return this.permissions.resolveRoom(identity, rawId);
    if (kind === 'node') return this.permissions.resolve(identity, rawId);

    const nodeId =
      kind === 'share'
        ? await this.permissions.nodeIdOfShare(rawId)
        : await this.permissions.nodeIdOfVersion(rawId);

    if (!nodeId) return { granted: false, reason: 'NOT_FOUND' };
    return this.permissions.resolve(identity, nodeId);
  }
}

/**
 * Both subclasses re-declare the constructor rather than inheriting it. A derived class with no
 * constructor of its own emits no `design:paramtypes`, so Nest would have nothing to inject and
 * every guarded route would fail at instantiation — which looks like a 500 on every endpoint at
 * once, and nothing like a DI problem.
 */

/** Reads. Grants owners and viewers; attaches the resolved `Access` for the handler to render. */
@Injectable()
export class ReadAccessGuard extends AccessGuard {
  constructor(reflector: Reflector, permissions: PermissionService) {
    super(reflector, permissions);
  }

  protected override readonly requireOwner = false;
}

/** Mutations. Owner only — sharing in this product is read-only by definition. */
@Injectable()
export class OwnerGuard extends AccessGuard {
  constructor(reflector: Reflector, permissions: PermissionService) {
    super(reflector, permissions);
  }

  protected override readonly requireOwner = true;
}
