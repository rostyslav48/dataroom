import { Global, Module } from '@nestjs/common';
import { OwnerGuard, ReadAccessGuard } from './access.guard';
import { PermissionService } from './permission.service';

/**
 * Global because every feature module's controllers reference the same two guards, and a guard
 * that has to be imported module by module is a guard somebody will forget to import.
 */
@Global()
@Module({
  providers: [PermissionService, ReadAccessGuard, OwnerGuard],
  exports: [PermissionService, ReadAccessGuard, OwnerGuard],
})
export class PermissionsModule {}
