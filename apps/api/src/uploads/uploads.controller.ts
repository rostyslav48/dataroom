import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import {
  endpoints,
  type CompleteUploadResponse,
  type InitUploadResponse,
  type RetryUploadResponse,
} from '@dataroom/contracts';
import { CurrentIdentity, isUser, type Identity } from '../auth/identity';
import { errors } from '../common/domain-error';
import { validate } from '../common/zod-validation.pipe';
import { OwnerGuard } from '../permissions/access.guard';
import { Resource } from '../permissions/resource.decorator';
import { InitUploadRequest } from './upload-request.schema';
import { UploadsService } from './uploads.service';

/**
 * The upload lifecycle's HTTP surface. Bytes never touch it — every route here moves metadata and
 * hands back a URL the browser talks to directly.
 *
 * All four are `OwnerGuard`: sharing is read-only by definition, so there is no such thing as a
 * recipient who may upload. `init` names its target in the body (the parent folder), the other three
 * name a version in the path — which the guard resolves back to its node, so an upload cannot be
 * completed, retried or aborted by anyone but the owner of the folder it was reserved in.
 */
@Controller()
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post(endpoints.uploads.init.path)
  @HttpCode(HttpStatus.CREATED)
  @Resource('node', 'parentId', 'body')
  @UseGuards(OwnerGuard)
  init(
    @Body(validate(InitUploadRequest)) body: InitUploadRequest,
    @CurrentIdentity() identity: Identity,
  ): Promise<InitUploadResponse> {
    if (!isUser(identity)) throw errors.unauthenticated();
    return this.uploads.init(body, identity.userId);
  }

  @Post(endpoints.uploads.complete.path)
  @HttpCode(HttpStatus.OK)
  @Resource('version', 'versionId')
  @UseGuards(OwnerGuard)
  complete(@Param('versionId') versionId: string): Promise<CompleteUploadResponse> {
    return this.uploads.complete(versionId);
  }

  @Post(endpoints.uploads.retry.path)
  @HttpCode(HttpStatus.OK)
  @Resource('version', 'versionId')
  @UseGuards(OwnerGuard)
  retry(@Param('versionId') versionId: string): Promise<RetryUploadResponse> {
    return this.uploads.retry(versionId);
  }

  @Post(endpoints.uploads.abort.path)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Resource('version', 'versionId')
  @UseGuards(OwnerGuard)
  abort(@Param('versionId') versionId: string): Promise<void> {
    return this.uploads.abort(versionId);
  }
}
