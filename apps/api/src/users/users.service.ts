import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { UserDto } from '@dataroom/contracts';
import { ShareRecipientEntity, UserEntity } from '../database/entities';

export interface GoogleIdentity {
  googleSub: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export const toUserDto = (user: UserEntity): UserDto => ({
  id: user.id,
  email: user.email,
  name: user.name,
  avatarUrl: user.avatarUrl,
});

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(ShareRecipientEntity)
    private readonly recipients: Repository<ShareRecipientEntity>,
  ) {}

  findById(id: string): Promise<UserEntity | null> {
    return this.users.findOne({ where: { id } });
  }

  /**
   * Keyed on the Google `sub`, never on the email.
   *
   * Someone who changes their Google email keeps their data rooms; a pending invite addressed to
   * their old address stops matching them, which is the correct security default — the invite was
   * issued to an address, and the address is what changed hands.
   */
  async upsertFromGoogle(identity: GoogleIdentity): Promise<UserEntity> {
    const existing = await this.users.findOne({ where: { googleSub: identity.googleSub } });

    if (existing) {
      existing.email = identity.email;
      existing.name = identity.name;
      existing.avatarUrl = identity.avatarUrl;
      return this.users.save(existing);
    }

    return this.users.save(
      this.users.create({
        googleSub: identity.googleSub,
        email: identity.email,
        name: identity.name,
        avatarUrl: identity.avatarUrl,
      }),
    );
  }

  /**
   * The step that makes "invite an email that has no account yet" actually work: the recipient row
   * was created with `user_id NULL`, and this is where it learns who that email turned out to be.
   *
   * Without it, permissioned sharing silently fails for everyone who was not already registered —
   * silently, because the share exists and looks correct in the owner's console.
   */
  async backfillShareRecipients(user: UserEntity): Promise<number> {
    const result = await this.recipients
      .createQueryBuilder()
      .update(ShareRecipientEntity)
      .set({ userId: user.id, acceptedAt: () => 'COALESCE(accepted_at, now())' })
      .where('email = :email', { email: user.email })
      .andWhere('user_id IS NULL')
      .execute();

    return result.affected ?? 0;
  }
}
