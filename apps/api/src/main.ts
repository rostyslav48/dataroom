import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { API_BASE } from '@dataroom/contracts';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { AppConfig } from './config/app.config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = app.get(AppConfig);

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
  app.enableShutdownHooks();

  await app.listen(config.port, '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  // Config failures land here: the message names the offending variable, and the process exits
  // non-zero rather than listening in a state where some requests would work.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
