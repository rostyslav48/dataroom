import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  AddRecipientsBody,
  CreateShareBody,
  endpoints,
  type ListSharesResponse,
  type ResolveShareResponse,
  type ShareDto,
} from '@dataroom/contracts';
import { CurrentIdentity, isUser, type Identity } from '../auth/identity';
import { Public } from '../auth/public.decorator';
import { errors } from '../common/domain-error';
import { validate } from '../common/zod-validation.pipe';
import { OwnerGuard } from '../permissions/access.guard';
import { Resource } from '../permissions/resource.decorator';
import { SharesService } from './shares.service';

@Controller()
export class SharesController {
  constructor(private readonly shares: SharesService) {}

  @Get(endpoints.shares.listForNode.path)
  @Resource('node')
  @UseGuards(OwnerGuard)
  listForNode(@Param('id') id: string): Promise<ListSharesResponse> {
    return this.shares.listForNode(id);
  }

  @Post(endpoints.shares.create.path)
  @HttpCode(HttpStatus.CREATED)
  @Resource('node')
  @UseGuards(OwnerGuard)
  create(
    @Param('id') id: string,
    @Body(validate(CreateShareBody)) body: CreateShareBody,
    @CurrentIdentity() identity: Identity,
  ): Promise<ShareDto> {
    if (!isUser(identity)) throw errors.unauthenticated();
    return this.shares.create(id, identity.userId, body);
  }

  @Get(endpoints.shares.listForRoom.path)
  @Resource('dataRoom')
  @UseGuards(OwnerGuard)
  listForRoom(@Param('id') id: string): Promise<ListSharesResponse> {
    return this.shares.listForRoom(id);
  }

  @Post(endpoints.shares.addRecipients.path)
  @HttpCode(HttpStatus.OK)
  @Resource('share')
  @UseGuards(OwnerGuard)
  addRecipients(
    @Param('id') id: string,
    @Body(validate(AddRecipientsBody)) body: AddRecipientsBody,
  ): Promise<ShareDto> {
    return this.shares.addRecipients(id, body);
  }

  @Delete(endpoints.shares.revokeRecipient.path)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Resource('share')
  @UseGuards(OwnerGuard)
  revokeRecipient(
    @Param('id') id: string,
    @Param('recipientId') recipientId: string,
  ): Promise<void> {
    return this.shares.revokeRecipient(id, recipientId);
  }

  @Delete(endpoints.shares.revoke.path)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Resource('share')
  @UseGuards(OwnerGuard)
  revoke(@Param('id') id: string): Promise<void> {
    return this.shares.revoke(id);
  }

  @Get(endpoints.shares.resolve.path)
  @Public()
  @Header('X-Robots-Tag', 'noindex')
  @UseGuards(ThrottlerGuard)
  resolve(@Param('token') token: string): Promise<ResolveShareResponse> {
    return this.shares.resolve(token);
  }
}
