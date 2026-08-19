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

/** How long a process retains the exact successor issued for an exchanged token. */
const REPLAY_GRACE_MS = 15_000;

interface SuccessorCacheEntry {
  issued: IssuedSession;
  expiresAt: number;
}

@Injectable()
export class TokensService {
  private readonly successorCache = new Map<string, SuccessorCacheEntry>();
  private readonly pendingSuccessors = new Map<string, Promise<IssuedSession>>();

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
      { secret: accessSecret, expiresIn: accessTtl, algorithm: 'HS256' },
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
   * A token presented twice is normally the replay signature. During the short browser-tab race
   * window, this process can instead return the exact successor it already issued. It never mints
   * an independent credential for the second presenter. If the successor cannot be verified from
   * this process's memory, the response is still to revoke the *whole family*.
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
        const age = Date.now() - existing.usedAt.getTime();
        if (age <= REPLAY_GRACE_MS && existing.revokedAt === null) {
          const cached = this.readCachedSuccessor(tokenHash);
          if (cached) return cached;

          // The winning request may still be persisting its successor. This promise exists only
          // when this process atomically claimed the row, so waiting for it preserves the same
          // fail-closed guarantee as the completed cache.
          const pending = this.pendingSuccessors.get(tokenHash);
          if (pending) return pending;
        }

        await this.revokeFamily(existing.familyId);
        throw errors.unauthenticated('That session was ended for safety. Sign in again.');
      }
      throw errors.unauthenticated('Your session has expired. Sign in again.');
    }

    const pending = this.issueSuccessor(row.user_id, row.family_id);
    this.pendingSuccessors.set(tokenHash, pending);

    try {
      const issued = await pending;
      this.cacheSuccessor(tokenHash, issued);
      return issued;
    } finally {
      this.pendingSuccessors.delete(tokenHash);
    }
  }

  private async issueSuccessor(userId: string, familyId: string): Promise<IssuedSession> {
    const user = await this.refreshTokens.manager.findOne(UserEntity, { where: { id: userId } });
    if (!user) throw errors.unauthenticated();
    return this.issue(user, familyId);
  }

  private cacheSuccessor(tokenHash: string, issued: IssuedSession): void {
    const now = Date.now();
    for (const [cachedHash, entry] of this.successorCache) {
      if (now > entry.expiresAt) this.successorCache.delete(cachedHash);
    }
    this.successorCache.set(tokenHash, { issued, expiresAt: now + REPLAY_GRACE_MS });
  }

  private readCachedSuccessor(tokenHash: string): IssuedSession | undefined {
    const entry = this.successorCache.get(tokenHash);
    if (!entry) return undefined;
    if (Date.now() <= entry.expiresAt) return entry.issued;
    this.successorCache.delete(tokenHash);
    return undefined;
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.refreshTokens.update({ familyId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  /** Logout: end the chain this token belongs to, not just the token itself. */
  async revokeByToken(presented: string): Promise<void> {
    const row = await this.refreshTokens.findOne({ where: { tokenHash: hash(presented) } });
    if (row) await this.revokeFamily(row.familyId);
  }

  /**
   * Deletes refresh-token rows that can no longer authenticate anything.
   *
   * A row is prunable once it is past `expires_at` — expiry is absolute, so nothing revives it —
   * and, if it was revoked, once the replay-detection window has passed. That second clause is the
   * subtle one: a revoked row is what makes a replay *detectable*, so deleting it early turns a
   * detected replay back into a plain "no such token", which reads as an ordinary expiry and
   * revokes nothing. Rows are kept for a full refresh lifetime past revocation for that reason.
   *
   * Returns the number deleted, so the caller can log a number that is true rather than attempted.
   */
  async pruneExpired(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.config.jwt.refreshTtlMs);
    const result = await this.refreshTokens
      .createQueryBuilder()
      .delete()
      .where('expires_at < :now', { now })
      .andWhere('(revoked_at IS NULL OR revoked_at < :cutoff)', { cutoff })
      .execute();
    return result.affected ?? 0;
  }
}
