import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { errors } from '../common/domain-error';
import { AppConfig } from '../config/app.config';

/**
 * Refuses a state-changing request that a browser says came from somewhere other than the web app.
 *
 * `POST /auth/refresh` and `POST /auth/logout` authenticate with nothing but the refresh cookie,
 * and in production that cookie is `SameSite=None` because the web app and the API sit on
 * unrelated registrable domains — so `SameSite` cannot be the control here. Any page on the
 * internet could `fetch(api + '/auth/refresh', { credentials: 'include' })` and, while CORS stops
 * it from *reading* the response, the rotation still happens: the victim's refresh token is spent
 * and their other tabs are logged out. A forced-logout primitive, on demand, from any origin.
 *
 * The check is "present and wrong", not "present and right". Browsers always send `Origin` on a
 * cross-origin POST, so the attack this exists for is always caught; a request with no `Origin` at
 * all is not a browser doing something on a page's behalf, and refusing those would break every
 * non-browser caller — health probes, the CLI, the integration suite — for no security gain.
 */
@Injectable()
export class SameOriginGuard implements CanActivate {
  constructor(private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.headers.origin;

    if (typeof origin === 'string' && origin !== '' && origin !== this.config.webOrigin) {
      throw errors.forbidden('That request did not come from the Data Room web app.');
    }
    return true;
  }
}
