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
 * Shared behaviour for the two legs of the Google flow. Neither leg decides which it is — the route
 * declaration does, by choosing a guard.
 *
 * An earlier version of this file had one guard that branched on
 * `request.path.endsWith('/callback')`. Express routes non-strictly and case-insensitively by
 * default, so `…/callback/` and `…/CALLBACK` reached the same handler with a path that failed that
 * test, while `passport-oauth2` still performed the code exchange — it picks its branch from
 * `req.query.code`, never from the path. The state check was therefore skippable by appending one
 * character, which is the whole login-CSRF back again. Two guards, each doing one thing
 * unconditionally, removes the class of bug rather than patching the instance.
 */
abstract class GoogleOAuthGuard extends AuthGuard('google') {
  constructor(protected readonly config: AppConfig) {
    super();
  }

  /**
   * `returnTo` leaves our control entirely — it is handed to Google and comes back through a
   * redirect — so it is validated here on the way out, and again in `returnToFromState` on the way
   * back in. This is the canonical location of an open-redirect bug.
   */
  protected validatedReturnTo(request: Request): string | undefined {
    const raw = request.query.returnTo;
    const result = GoogleAuthQuery.safeParse(raw === undefined ? {} : { returnTo: String(raw) });

    if (!result.success) {
      throw errors.validationFailed(
        { returnTo: result.error.issues.map((issue) => issue.message) },
        'That return path is not allowed.',
      );
    }
    return result.data.returnTo;
  }

  protected cookieOptions(): {
    httpOnly: true;
    secure: boolean;
    sameSite: 'lax';
    path: string;
  } {
    return {
      httpOnly: true,
      secure: this.config.cookie.secure,
      // Lax, not None: the callback is a top-level GET navigation from Google, which Lax allows,
      // and Lax is the stricter of the two that still works.
      sameSite: 'lax',
      path: this.config.cookie.path,
    };
  }
}

/**
 * The outbound leg. Mints a nonce into a short-lived cookie and packs it into `state` alongside the
 * validated `returnTo`.
 */
@Injectable()
export class GoogleStartGuard extends GoogleOAuthGuard {
  constructor(config: AppConfig) {
    super(config);
  }

  override getAuthenticateOptions(context: ExecutionContext): IAuthModuleOptions {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const returnTo = this.validatedReturnTo(request);
    const nonce = randomBytes(18).toString('base64url');

    response.cookie(OAUTH_STATE_COOKIE, nonce, { ...this.cookieOptions(), maxAge: STATE_TTL_MS });

    return { state: encodeState(returnTo, nonce) };
  }
}

/**
 * The inbound leg. Verifies the nonce **before** passport exchanges the authorization code, so a
 * forged callback never reaches Google's token endpoint with our client secret.
 */
@Injectable()
export class GoogleCallbackGuard extends GoogleOAuthGuard {
  constructor(config: AppConfig) {
    super(config);
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    this.verifyState(context);
    return (await super.canActivate(context)) as boolean;
  }

  /** No options on the way back: `state` is ours to check, not passport's to re-send. */
  override getAuthenticateOptions(): IAuthModuleOptions {
    return {};
  }

  /** Public so the test harness exercises the real check rather than stubbing past it. */
  verifyState(context: ExecutionContext): void {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const cookies = request.cookies as Record<string, string> | undefined;
    const expected = cookies?.[OAUTH_STATE_COOKIE];
    const presented = stateNonceOf(request.query.state);

    // Consume it either way: a nonce that survives a failed attempt is a nonce worth retrying.
    response.clearCookie(OAUTH_STATE_COOKIE, this.cookieOptions());

    if (presented === null || !nonceMatches(expected, presented)) {
      throw errors.forbidden('That sign-in link has expired. Start again from the login page.');
    }
  }
}
