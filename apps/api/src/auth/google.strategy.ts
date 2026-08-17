import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-google-oauth20';
import { errors } from '../common/domain-error';
import { AppConfig } from '../config/app.config';
import type { GoogleIdentity } from '../users/users.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: AppConfig) {
    super({
      clientID: config.google.clientId,
      clientSecret: config.google.clientSecret,
      callbackURL: config.google.callbackUrl,
      // Exactly what the product needs to identify someone and address an invitation to them.
      scope: ['openid', 'email', 'profile'],
    });
  }

  validate(_accessToken: string, _refreshToken: string, profile: Profile): GoogleIdentity {
    const primary = profile.emails?.[0];
    const email = primary?.value;

    if (!email) {
      throw errors.forbidden(
        'Your Google account did not share an email address. Data Room needs one to share documents with you.',
      );
    }

    // Permissioned sharing matches on email. Accepting an unverified one would create an account
    // that silently cannot receive the shares addressed to it.
    if (primary?.verified !== undefined && String(primary.verified) !== 'true') {
      throw errors.forbidden(
        'Your Google email address is not verified. Verify it with Google, then sign in again.',
      );
    }

    return {
      googleSub: profile.id,
      email: email.toLowerCase(),
      name: profile.displayName || email,
      avatarUrl: profile.photos?.[0]?.value ?? null,
    };
  }
}
