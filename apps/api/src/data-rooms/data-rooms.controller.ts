import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  CreateDataRoomBody,
  UpdateDataRoomBody,
  endpoints,
  type DataRoomDto,
  type ListDataRoomsResponse,
} from '@dataroom/contracts';
import { CurrentIdentity, isUser, type Identity } from '../auth/identity';
import { AllowsShareToken } from '../auth/public.decorator';
import { errors } from '../common/domain-error';
import { validate } from '../common/zod-validation.pipe';
import { OwnerGuard, ReadAccessGuard } from '../permissions/access.guard';
import { CurrentAccess, Resource } from '../permissions/resource.decorator';
import type { AccessGranted } from '../permissions/access';
import { DataRoomsService } from './data-rooms.service';

@Controller()
export class DataRoomsController {
  constructor(private readonly rooms: DataRoomsService) {}

  @Get(endpoints.dataRooms.list.path)
  list(@CurrentIdentity() identity: Identity): Promise<ListDataRoomsResponse> {
    if (!isUser(identity)) throw errors.unauthenticated();
    return this.rooms.list(identity.userId, identity.email);
  }

  @Post(endpoints.dataRooms.create.path)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(validate(CreateDataRoomBody)) body: CreateDataRoomBody,
    @CurrentIdentity() identity: Identity,
  ): Promise<DataRoomDto> {
    if (!isUser(identity)) throw errors.unauthenticated();
    return this.rooms.create(identity.userId, body.name);
  }

  /** A room is browsed through a node, so access is resolved against its root — or your share root. */
  @Get(endpoints.dataRooms.get.path)
  @AllowsShareToken()
  @Resource('dataRoom')
  @UseGuards(ReadAccessGuard)
  get(@Param('id') id: string, @CurrentAccess() access: AccessGranted): Promise<DataRoomDto> {
    return this.rooms.get(id, access);
  }

  @Patch(endpoints.dataRooms.update.path)
  @Resource('dataRoom')
  @UseGuards(OwnerGuard)
  update(
    @Param('id') id: string,
    @Body(validate(UpdateDataRoomBody)) body: UpdateDataRoomBody,
  ): Promise<DataRoomDto> {
    return this.rooms.rename(id, body.name);
  }

  @Delete(endpoints.dataRooms.remove.path)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Resource('dataRoom')
  @UseGuards(OwnerGuard)
  remove(@Param('id') id: string): Promise<void> {
    return this.rooms.softDelete(id);
  }
}
