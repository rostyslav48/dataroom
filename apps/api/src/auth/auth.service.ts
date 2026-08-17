import { Injectable } from '@nestjs/common';
import type { UserDto } from '@dataroom/contracts';
import { errors } from '../common/domain-error';
import { toUserDto, UsersService, type GoogleIdentity } from '../users/users.service';
import { TokensService, type IssuedSession } from './tokens.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokensService,
  ) {}

  /**
   * Sign-in, in the order that matters: create or update the user, *then* claim any share
   * invitations addressed to their email, *then* issue the session. A session issued before the
   * backfill would see none of the shares waiting for it until the next login.
   */
  async signInWithGoogle(identity: GoogleIdentity): Promise<IssuedSession> {
    const user = await this.users.upsertFromGoogle(identity);
    await this.users.backfillShareRecipients(user);
    return this.tokens.issue(user);
  }

  async refresh(refreshToken: string | undefined): Promise<IssuedSession> {
    if (!refreshToken) throw errors.unauthenticated('Sign in to continue.');
    return this.tokens.rotate(refreshToken);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) await this.tokens.revokeByToken(refreshToken);
  }

  async me(userId: string): Promise<UserDto> {
    const user = await this.users.findById(userId);
    if (!user) throw errors.unauthenticated();
    return toUserDto(user);
  }
}
