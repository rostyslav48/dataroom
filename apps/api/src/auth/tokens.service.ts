import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type { SessionDto } from '@dataroom/contracts';
import { errors } from '../common/domain-error';
import { AppConfig } from '../config/app.config';
import { RefreshTokenEntity, UserEntity } from '../database/entities';
import { updateReturning } from '../database/sql';
import { toUserDto } from '../users/users.service';

export interface IssuedSession {
  session: SessionDto;
  /** The opaque refresh token, for the cookie. Only ever leaves this service in that direction. */
  refreshToken: string;
}

/** Stored hashed: a leaked database row is then a useless string rather than a live session. */
const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    @InjectRepository(RefreshTokenEntity)
    private readonly refreshTokens: Repository<RefreshTokenEntity>,
  ) {}

  async issue(user: UserEntity, familyId: string = randomUUID()): Promise<IssuedSession> {
    const { accessSecret, accessTtl, accessTtlMs, refreshTtlMs } = this.config.jwt;

    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email },
      { secret: accessSecret, expiresIn: accessTtl },
    );

    const refreshToken = randomBytes(48).toString('base64url');
    await this.refreshTokens.save(
      this.refreshTokens.create({
        userId: user.id,
        familyId,
        tokenHash: hash(refreshToken),
        expiresAt: new Date(Date.now() + refreshTtlMs),
      }),
    );

    return {
      session: {
        user: toUserDto(user),
        accessToken,
        accessTokenExpiresAt: new Date(Date.now() + accessTtlMs).toISOString(),
      },
      refreshToken,
    };
  }

  /**
   * Exchange a refresh token for a new pair.
   *
   * The claim is taken atomically — `UPDATE ... WHERE used_at IS NULL RETURNING` — so two
   * simultaneous refreshes cannot both succeed and then accuse each other of replay.
   *
   * A token presented twice is the replay signature. The response is to revoke the *whole family*,
   * not just that row: by then the attacker and the legitimate client hold tokens descended from
   * the same login and there is no way to tell which is which, so both must be ended.
   */
  async rotate(presented: string): Promise<IssuedSession> {
    const tokenHash = hash(presented);

    const claimed = await updateReturning<{ user_id: string; family_id: string }>(
      this.refreshTokens,
      `UPDATE refresh_tokens
          SET used_at = now()
        WHERE token_hash = $1
          AND used_at IS NULL
          AND revoked_at IS NULL
          AND expires_at > now()
      RETURNING user_id, family_id`,
      [tokenHash],
    );

    const row = claimed[0];
    if (!row) {
      const existing = await this.refreshTokens.findOne({ where: { tokenHash } });
      if (existing?.usedAt) {
        await this.revokeFamily(existing.familyId);
        throw errors.unauthenticated('That session was ended for safety. Sign in again.');
      }
      throw errors.unauthenticated('Your session has expired. Sign in again.');
    }

    const user = await this.refreshTokens.manager.findOne(UserEntity, {
      where: { id: row.user_id },
    });
    if (!user) throw errors.unauthenticated();

    return this.issue(user, row.family_id);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.refreshTokens.update({ familyId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  /** Logout: end the chain this token belongs to, not just the token itself. */
  async revokeByToken(presented: string): Promise<void> {
    const row = await this.refreshTokens.findOne({ where: { tokenHash: hash(presented) } });
    if (row) await this.revokeFamily(row.familyId);
  }
}
