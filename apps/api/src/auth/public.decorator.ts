import { SetMetadata, type CustomDecorator } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'dataroom:isPublic';

/**
 * Opt an endpoint out of `JwtAuthGuard`, which is applied globally.
 *
 * Authentication is on by default and switched off per endpoint, rather than the reverse: a
 * forgotten `@UseGuards` is silent, a forgotten `@Public()` is a 401 the first time anyone tries.
 */
export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC_KEY, true);

export const ALLOWS_SHARE_TOKEN_KEY = 'dataroom:allowsShareToken';

/**
 * Marks an endpoint as reachable by an anonymous caller presenting `X-Share-Token`. The token is
 * only *carried* by this layer — whether it grants anything is `PermissionService`'s question.
 */
export const AllowsShareToken = (): CustomDecorator<string> =>
  SetMetadata(ALLOWS_SHARE_TOKEN_KEY, true);
