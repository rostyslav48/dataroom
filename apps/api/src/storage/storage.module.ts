import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../config/app.config';
import { STORAGE_SERVICE } from './storage.service';
import { SupabaseStorageService } from './supabase-storage.service';

/**
 * The interface has exactly one implementation, and that is on purpose rather than by accident:
 * moving to S3S is one class, and the integration tests substitute an in-memory implementation so
 * they never depend on a network round trip to a third party.
 */
@Global()
@Module({
  providers: [
    {
      provide: STORAGE_SERVICE,
      useFactory: (config: AppConfig) => new SupabaseStorageService(config),
      inject: [AppConfig],
    },
  ],
  exports: [STORAGE_SERVICE],
})
export class StorageModule {}
