import { Module } from '@nestjs/common';
import { NodesController } from './nodes.controller';
import { NodesService } from './nodes.service';
import { RollupReconciler } from './rollup-reconciler';

@Module({
  controllers: [NodesController],
  providers: [NodesService, RollupReconciler],
  exports: [NodesService],
})
export class NodesModule {}
