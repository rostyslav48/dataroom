import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { SHARE_TOKEN_HEADER } from '@dataroom/contracts';
import { errors } from '../common/domain-error';
import { AppConfig } from '../config/app.config';
import { ALLOWS_SHARE_TOKEN_KEY, IS_PUBLIC_KEY } from './public.decorator';
import type { Identity, RequestWithIdentity } from './identity';

export interface AccessTokenClaims {
  sub: string;
  email: string;
}

/**
 * Applied globally: authentication is on by default and switched off per endpoint with `@Public()`.
 * A forgotten guard is silent; a forgotten `@Public()` is a 401 the first time anyone tries.
 *
 * The guard establishes an `Identity` and stops. It never decides what that identity may read —
 * that is `ReadAccessGuard`'s job, and keeping the two apart is what makes the permission model
 * auditable in one file.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithIdentity>();

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const allowsShareToken = this.reflector.getAllAndOverride<boolean>(ALLOWS_SHARE_TOKEN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const identity = await this.identify(request);

    if (identity) {
      request.identity = identity;
      return true;
    }

    const shareToken = this.shareTokenOf(request);
    if (isPublic || (allowsShareToken && shareToken)) {
      request.identity = { kind: 'anonymous', shareToken };
      return true;
    }

    throw errors.unauthenticated();
  }

  private async identify(request: RequestWithIdentity): Promise<Identity | null> {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;

    try {
      const claims = await this.jwt.verifyAsync<AccessTokenClaims>(header.slice('Bearer '.length), {
        secret: this.config.jwt.accessSecret,
      });
      return { kind: 'user', userId: claims.sub, email: claims.email };
    } catch {
      // An expired or forged token is simply not an identity. Whether that is fatal depends on the
      // endpoint, which is decided above.
      return null;
    }
  }

  private shareTokenOf(request: RequestWithIdentity): string | null {
    const value = request.headers[SHARE_TOKEN_HEADER];
    if (typeof value === 'string' && value.length > 0) return value;
    return null;
  }
}
