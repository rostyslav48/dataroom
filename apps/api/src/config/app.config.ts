import { Injectable } from '@nestjs/common';
import { durationToMs, type Env } from './env.schema';

/**
 * The typed view of the environment that the rest of the application consumes.
 *
 * Nothing outside `config/` reads `process.env` — enforced by a lint rule — so there is one place
 * where a variable's meaning, default and coercion live.
 */
@Injectable()
export class AppConfig {
  constructor(private readonly env: Env) {}

  get nodeEnv(): Env['NODE_ENV'] {
    return this.env.NODE_ENV;
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get port(): number {
    return this.env.PORT;
  }

  get webOrigin(): string {
    return this.env.WEB_ORIGIN;
  }

  get databaseUrl(): string {
    return this.env.DATABASE_URL;
  }

  get google(): { clientId: string; clientSecret: string; callbackUrl: string } {
    return {
      clientId: this.env.GOOGLE_CLIENT_ID,
      clientSecret: this.env.GOOGLE_CLIENT_SECRET,
      callbackUrl: this.env.GOOGLE_CALLBACK_URL,
    };
  }

  get jwt(): {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: string;
    accessTtlMs: number;
    refreshTtl: string;
    refreshTtlMs: number;
  } {
    return {
      accessSecret: this.env.JWT_ACCESS_SECRET,
      refreshSecret: this.env.JWT_REFRESH_SECRET,
      accessTtl: this.env.ACCESS_TOKEN_TTL,
      accessTtlMs: durationToMs(this.env.ACCESS_TOKEN_TTL),
      refreshTtl: this.env.REFRESH_TOKEN_TTL,
      refreshTtlMs: durationToMs(this.env.REFRESH_TOKEN_TTL),
    };
  }

  /**
   * Cross-site in production (web on *.vercel.app, API on *.onrender.com) and same-site locally.
   * Host-only in both: no `Domain` attribute, because both platform domains are on the Public
   * Suffix List and a `Domain` attribute would simply be rejected.
   */
  get cookie(): {
    name: string;
    path: string;
    sameSite: 'lax' | 'none' | 'strict';
    secure: boolean;
    maxAgeMs: number;
  } {
    return {
      name: 'refresh_token',
      path: '/api/v1/auth',
      sameSite: this.env.COOKIE_SAMESITE,
      secure: this.env.COOKIE_SECURE,
      maxAgeMs: durationToMs(this.env.REFRESH_TOKEN_TTL),
    };
  }

  get storage(): { url: string; serviceRoleKey: string; bucket: string } {
    return {
      url: this.env.SUPABASE_URL,
      serviceRoleKey: this.env.SUPABASE_SERVICE_ROLE_KEY,
      bucket: this.env.SUPABASE_BUCKET,
    };
  }

  get maxUploadBytes(): number {
    return this.env.MAX_UPLOAD_BYTES;
  }
}
