import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { API_BASE } from '@dataroom/contracts';
import { HttpExceptionFilter } from './common/http-exception.filter';
import type { AppConfig } from './config/app.config';

/**
 * The middleware stack, in one function, so the integration tests exercise the *same* stack the
 * production process does. A test app assembled by hand drifts from `main.ts` and then proves
 * things about an application that is not the one deployed.
 */
export function configureApp(app: INestApplication, config: AppConfig): void {
  app.setGlobalPrefix(API_BASE);
  app.use(cookieParser());
  app.use(helmet());
  // Exact origin, never a wildcard — a wildcard is incompatible with credentialed requests, and
  // reflecting the request's Origin would defeat the point of having an allowlist at all.
  app.enableCors({
    origin: config.webOrigin,
    credentials: true,
    exposedHeaders: ['X-Request-Id'],
  });
  app.useGlobalFilters(new HttpExceptionFilter());
}
