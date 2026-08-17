import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { AppConfig } from './config/app.config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = app.get(AppConfig);
  configureApp(app, config);
  app.enableShutdownHooks();

  await app.listen(config.port, '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  // Config failures land here: the message names the offending variable, and the process exits
  // non-zero rather than listening in a state where only some requests would work.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
