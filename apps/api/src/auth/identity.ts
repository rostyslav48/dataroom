import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * *Who is asking* — and nothing about what they may see. Authentication answers identity;
 * authorization answers access, in `PermissionService`. Merging the two is how permission bugs end
 * up hidden inside login code.
 */
export type Identity =
  | {
      kind: 'user';
      userId: string;
      email: string;
      /**
       * A signed-in visitor can arrive on a public link too — that is the normal case, not an
       * exotic one, since most people are signed into something. Dropping the header for
       * authenticated callers would deny them a link that works fine in a private window.
       */
      shareToken: string | null;
    }
  | { kind: 'anonymous'; shareToken: string | null };

export interface RequestWithIdentity extends Request {
  identity?: Identity;
}

export const CurrentIdentity = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Identity => {
    const request = context.switchToHttp().getRequest<RequestWithIdentity>();
    // The global guard runs first and always sets this; a missing identity is a wiring bug.
    if (!request.identity) throw new Error('No identity on request — is JwtAuthGuard registered?');
    return request.identity;
  },
);

export const isUser = (identity: Identity): identity is Extract<Identity, { kind: 'user' }> =>
  identity.kind === 'user';
