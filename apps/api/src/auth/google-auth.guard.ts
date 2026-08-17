import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard, type IAuthModuleOptions } from '@nestjs/passport';
import type { Request } from 'express';
import { GoogleAuthQuery } from '@dataroom/contracts';
import { errors } from '../common/domain-error';
import { encodeState } from './return-to';

/**
 * Wraps passport's Google guard for one reason: to carry `returnTo` through the OAuth round trip
 * in `state`, having validated it first. An unvalidated `returnTo` here is the textbook
 * open-redirect, so the check happens at the controller boundary rather than being assumed.
 */
@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  override getAuthenticateOptions(context: ExecutionContext): IAuthModuleOptions {
    const request = context.switchToHttp().getRequest<Request>();

    const raw = request.query.returnTo;
    const result = GoogleAuthQuery.safeParse(raw === undefined ? {} : { returnTo: String(raw) });

    if (!result.success) {
      throw errors.validationFailed(
        { returnTo: result.error.issues.map((issue) => issue.message) },
        'That return path is not allowed.',
      );
    }

    return { state: encodeState(result.data.returnTo) };
  }
}
