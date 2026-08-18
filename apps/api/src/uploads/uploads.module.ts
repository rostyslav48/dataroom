import { Module } from '@nestjs/common';
import { NodesModule } from '../nodes/nodes.module';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

/**
 * `StorageModule` is `@Global`, so `STORAGE_SERVICE` needs no import here — which is also what lets
 * the test harness swap in the in-memory implementation with a single override.
 */
@Module({
  imports: [NodesModule],
  controllers: [UploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
