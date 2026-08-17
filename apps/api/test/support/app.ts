import { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { GoogleAuthGuard } from '../../src/auth/google-auth.guard';
import { configureApp } from '../../src/bootstrap';
import { AppConfig } from '../../src/config/app.config';
import { UserEntity } from '../../src/database/entities';
import type { GoogleIdentity } from '../../src/users/users.service';
import { resetDatabase } from './database';

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
  /** Set this before driving `/auth/google/callback`. */
  googleProfile: { current: GoogleIdentity | null };
  accessTokenFor(user: Pick<UserEntity, 'id' | 'email'>): Promise<string>;
  authHeader(user: Pick<UserEntity, 'id' | 'email'>): Promise<{ Authorization: string }>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

const googleProfile: { current: GoogleIdentity | null } = { current: null };

class TestGoogleAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    // The real guard's validation, unmodified — this is where `returnTo` is rejected.
    new GoogleAuthGuard().getAuthenticateOptions(context);

    const request = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    if (googleProfile.current) request.user = googleProfile.current;
    return true;
  }
}

export async function createTestHarness(): Promise<TestHarness> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideGuard(GoogleAuthGuard)
    .useClass(TestGoogleAuthGuard)
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
    googleProfile,
    accessTokenFor,
    authHeader: async (user) => ({ Authorization: `Bearer ${await accessTokenFor(user)}` }),
    reset: async () => {
      googleProfile.current = null;
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
