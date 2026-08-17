import { resolve } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule, ConfigService } from '@nestjs/config';
import { AppConfig } from './app.config';
import { validateEnv } from './env.schema';

/**
 * `.env` is read from the repo root so a single file configures the whole workspace, with an
 * app-local override for the rare case of running two APIs side by side.
 */
const envFilePath = [resolve(__dirname, '../../../../.env'), resolve(__dirname, '../../.env')];

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath,
      // Boot fails here, before anything listens, if a variable is missing or malformed.
      validate: validateEnv,
    }),
  ],
  providers: [
    {
      provide: AppConfig,
      // ConfigService is injected purely to order this factory after `forRoot` has loaded the
      // `.env` files into the process environment; its value is not used.
      useFactory: (_config: ConfigService): AppConfig => new AppConfig(validateEnv(process.env)),
      inject: [ConfigService],
    },
  ],
  exports: [AppConfig],
})
export class ConfigModule {}
