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
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CreateFolderBody,
  ListChildrenQuery,
  MoveNodeBody,
  RenameNodeBody,
  endpoints,
  type DeletePreviewDto,
  type ListChildrenResponse,
  type NodeDetailResponse,
  type NodeDto,
  type NodeStatsDto,
} from '@dataroom/contracts';
import { AllowsShareToken } from '../auth/public.decorator';
import { CurrentIdentity, isUser, type Identity } from '../auth/identity';
import { validate } from '../common/zod-validation.pipe';
import { errors } from '../common/domain-error';
import { OwnerGuard, ReadAccessGuard } from '../permissions/access.guard';
import { CurrentAccess, Resource } from '../permissions/resource.decorator';
import type { AccessGranted } from '../permissions/access';
import { NodesService } from './nodes.service';

/**
 * Reads are behind `ReadAccessGuard`, mutations behind `OwnerGuard`, and there is not a single
 * inline ownership check anywhere in this file. One set of read endpoints serves both the owner and
 * a share recipient, so the shared view cannot drift out of step with the owner's — and it is the
 * guard, not the route, that enforces read-only.
 */
@Controller()
export class NodesController {
  constructor(private readonly nodes: NodesService) {}

  @Get(endpoints.nodes.get.path)
  @AllowsShareToken()
  @Resource('node')
  @UseGuards(ReadAccessGuard)
  getNode(
    @Param('id') id: string,
    @CurrentAccess() access: AccessGranted,
  ): Promise<NodeDetailResponse> {
    return this.nodes.getDetail(id, access);
  }

  @Get(endpoints.nodes.children.path)
  @AllowsShareToken()
  @Resource('node')
  @UseGuards(ReadAccessGuard)
  listChildren(
    @Param('id') id: string,
    @Query(validate(ListChildrenQuery)) query: ListChildrenQuery,
    @CurrentAccess() access: AccessGranted,
  ): Promise<ListChildrenResponse> {
    return this.nodes.listChildren(id, query, access);
  }

  @Get(endpoints.nodes.stats.path)
  @AllowsShareToken()
  @Resource('node')
  @UseGuards(ReadAccessGuard)
  stats(@Param('id') id: string): Promise<NodeStatsDto> {
    return this.nodes.stats(id);
  }

  /** Owner-only: the blast radius of a delete is not something a viewer needs, or should see. */
  @Get(endpoints.nodes.deletePreview.path)
  @Resource('node')
  @UseGuards(OwnerGuard)
  deletePreview(@Param('id') id: string): Promise<DeletePreviewDto> {
    return this.nodes.deletePreview(id);
  }

  @Post(endpoints.nodes.createFolder.path)
  @HttpCode(HttpStatus.CREATED)
  @Resource('node', 'parentId', 'body')
  @UseGuards(OwnerGuard)
  createFolder(
    @Body(validate(CreateFolderBody)) body: CreateFolderBody,
    @CurrentIdentity() identity: Identity,
  ): Promise<NodeDto> {
    if (!isUser(identity)) throw errors.unauthenticated();
    return this.nodes.createFolder(body.parentId, body.name, identity.userId);
  }

  @Patch(endpoints.nodes.rename.path)
  @Resource('node')
  @UseGuards(OwnerGuard)
  rename(
    @Param('id') id: string,
    @Body(validate(RenameNodeBody)) body: RenameNodeBody,
  ): Promise<NodeDto> {
    return this.nodes.rename(id, body.name);
  }

  @Post(endpoints.nodes.move.path)
  @HttpCode(HttpStatus.OK)
  @Resource('node')
  @UseGuards(OwnerGuard)
  move(@Param('id') id: string, @Body(validate(MoveNodeBody)) body: MoveNodeBody): Promise<NodeDto> {
    return this.nodes.move(id, body.parentId);
  }

  @Delete(endpoints.nodes.remove.path)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Resource('node')
  @UseGuards(OwnerGuard)
  remove(@Param('id') id: string): Promise<void> {
    return this.nodes.softDelete(id);
  }
}
