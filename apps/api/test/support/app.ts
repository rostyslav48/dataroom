import { CanActivate, ExecutionContext, INestApplication, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { GoogleCallbackGuard, GoogleStartGuard } from '../../src/auth/google-auth.guard';
import { configureApp } from '../../src/bootstrap';
import { AppConfig } from '../../src/config/app.config';
import { UserEntity } from '../../src/database/entities';
import { STORAGE_SERVICE } from '../../src/storage/storage.service';
import type { GoogleIdentity } from '../../src/users/users.service';
import { resetDatabase } from './database';
import { FakeStorageService } from './fake-storage';

/**
 * The real application — real modules, real database, real middleware stack via `configureApp`.
 *
 * Exactly one thing is substituted: the Google guard, because Google will not authenticate a test
 * runner. The substitute still runs the *real* guard's `returnTo` validation, so the open-redirect
 * check is under test rather than stubbed past. Nothing test-only exists in `apps/api/src`; there
 * is no env-flagged login backdoor in a product whose whole premise is access control.
 */
export interface TestHarness {
  app: INestApplication;
  dataSource: DataSource;
  config: AppConfig;
  /**
   * The in-memory object store standing in for Supabase. `putObject` is the browser's `PUT`, and
   * `minted` is the record every TTL and disposition assertion reads.
   */
  storage: FakeStorageService;
  /** Set this before driving `/auth/google/callback`. */
  googleProfile: { current: GoogleIdentity | null };
  accessTokenFor(user: Pick<UserEntity, 'id' | 'email'>): Promise<string>;
  authHeader(user: Pick<UserEntity, 'id' | 'email'>): Promise<{ Authorization: string }>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

const googleProfile: { current: GoogleIdentity | null } = { current: null };

/**
 * Google will not authenticate a test runner, so the code-for-profile exchange is substituted —
 * and nothing else. The real guard's `returnTo` validation and its `state`/nonce verification both
 * run unmodified, so the open-redirect and login-CSRF defences are genuinely under test rather than
 * stubbed past.
 */
@Injectable()
class TestGoogleStartGuard implements CanActivate {
  private readonly real: GoogleStartGuard;

  constructor(config: AppConfig) {
    this.real = new GoogleStartGuard(config);
  }

  canActivate(context: ExecutionContext): boolean {
    // The real thing: validates `returnTo` and mints the nonce cookie.
    this.real.getAuthenticateOptions(context);
    return true;
  }
}

@Injectable()
class TestGoogleCallbackGuard implements CanActivate {
  private readonly real: GoogleCallbackGuard;

  constructor(config: AppConfig) {
    this.real = new GoogleCallbackGuard(config);
  }

  canActivate(context: ExecutionContext): boolean {
    // The real state check, unmodified — this is the login-CSRF defence under test.
    this.real.verifyState(context);

    const request = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    if (googleProfile.current) request.user = googleProfile.current;
    return true;
  }
}

export async function createTestHarness(): Promise<TestHarness> {
  const storage = new FakeStorageService();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideGuard(GoogleStartGuard)
    .useClass(TestGoogleStartGuard)
    .overrideGuard(GoogleCallbackGuard)
    .useClass(TestGoogleCallbackGuard)
    // The second and last substitution in the whole suite. Supabase Storage is a network round trip
    // to a third party with credentials CI does not have, and the states that matter here — object
    // missing, size disagreeing with what was declared — are awkward to arrange against the real
    // thing and trivial in memory. The interface exists so this costs nothing.
    .overrideProvider(STORAGE_SERVICE)
    .useValue(storage)
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  const config = app.get(AppConfig);
  configureApp(app, config);
  await app.init();

  const dataSource = app.get(DataSource);
  const jwt = app.get(JwtService);

  const accessTokenFor = (user: Pick<UserEntity, 'id' | 'email'>): Promise<string> =>
    jwt.signAsync(
      { sub: user.id, email: user.email },
      { secret: config.jwt.accessSecret, expiresIn: config.jwt.accessTtl },
    );

  return {
    app,
    dataSource,
    config,
    storage,
    googleProfile,
    accessTokenFor,
    authHeader: async (user) => ({ Authorization: `Bearer ${await accessTokenFor(user)}` }),
    reset: async () => {
      googleProfile.current = null;
      storage.reset();
      await resetDatabase(dataSource);
    },
    close: async () => {
      await app.close();
    },
  };
}

/** `supertest(harness.app.getHttpServer())` needs the raw server; this keeps call sites short. */
export const httpServer = (harness: TestHarness): ReturnType<INestApplication['getHttpServer']> =>
  harness.app.getHttpServer();
