import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShareRecipientEntity, UserEntity } from '../database/entities';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, ShareRecipientEntity])],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
