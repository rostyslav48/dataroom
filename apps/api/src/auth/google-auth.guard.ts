import { randomBytes } from 'node:crypto';
import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard, type IAuthModuleOptions } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { GoogleAuthQuery } from '@dataroom/contracts';
import { errors } from '../common/domain-error';
import { AppConfig } from '../config/app.config';
import { encodeState, nonceMatches, stateNonceOf } from './return-to';

/** Short-lived, httpOnly, and consumed once: it exists only to bind a callback to its own flow. */
export const OAUTH_STATE_COOKIE = 'oauth_state';
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Wraps passport's Google guard for two reasons, both of them security rather than convenience:
 *
 * 1. `returnTo` is validated before it is handed to Google, because an unvalidated one here is the
 *    textbook open redirect.
 * 2. A nonce is minted into a cookie and echoed through `state`, and the callback is rejected
 *    unless the two match. `passport-oauth2` installs a `NullStore` when no session store is
 *    configured — its `verify` returns true unconditionally — so without this check the callback
 *    accepts any `state` at all, and a login-CSRF hands the victim a session belonging to the
 *    attacker.
 */
@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  constructor(private readonly config: AppConfig) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    if (request.path.endsWith('/callback')) {
      this.verifyState(context);
    }

    return (await super.canActivate(context)) as boolean;
  }

  /**
   * Called by passport on the way out. Mints the nonce, stores it, and packs it into `state`
   * alongside the validated `returnTo`.
   */
  override getAuthenticateOptions(context: ExecutionContext): IAuthModuleOptions {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const raw = request.query.returnTo;
    const result = GoogleAuthQuery.safeParse(raw === undefined ? {} : { returnTo: String(raw) });

    if (!result.success) {
      throw errors.validationFailed(
        { returnTo: result.error.issues.map((issue) => issue.message) },
        'That return path is not allowed.',
      );
    }

    if (request.path.endsWith('/callback')) return {};

    const nonce = randomBytes(18).toString('base64url');
    response.cookie(OAUTH_STATE_COOKIE, nonce, {
      httpOnly: true,
      secure: this.config.cookie.secure,
      // Lax, not None: the callback is a top-level GET navigation from Google, which Lax allows,
      // and Lax is the stricter of the two that still works.
      sameSite: 'lax',
      path: this.config.cookie.path,
      maxAge: STATE_TTL_MS,
    });

    return { state: encodeState(result.data.returnTo, nonce) };
  }

  /** Public so the test harness exercises the real check rather than stubbing past it. */
  verifyState(context: ExecutionContext): void {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const cookies = request.cookies as Record<string, string> | undefined;
    const expected = cookies?.[OAUTH_STATE_COOKIE];
    const presented = stateNonceOf(request.query.state);

    // Consume it either way: a nonce that survives a failed attempt is a nonce worth retrying.
    response.clearCookie(OAUTH_STATE_COOKIE, {
      httpOnly: true,
      secure: this.config.cookie.secure,
      sameSite: 'lax',
      path: this.config.cookie.path,
    });

    if (presented === null || !nonceMatches(expected, presented)) {
      throw errors.forbidden('That sign-in link has expired. Start again from the login page.');
    }
  }
}
