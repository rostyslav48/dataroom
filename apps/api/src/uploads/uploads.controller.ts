import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Redirect,
  UseGuards,
} from '@nestjs/common';
import {
  InitUploadBody,
  endpoints,
  type CompleteUploadResponse,
  type InitUploadResponse,
  type RetryUploadResponse,
} from '@dataroom/contracts';
import { CurrentIdentity, isUser, type Identity } from '../auth/identity';
import { AllowsShareToken } from '../auth/public.decorator';
import { errors } from '../common/domain-error';
import { validate } from '../common/zod-validation.pipe';
import { OwnerGuard, ReadAccessGuard } from '../permissions/access.guard';
import { Resource } from '../permissions/resource.decorator';
import { UploadsService } from './uploads.service';

/** What Nest's `@Redirect()` expects back from a handler. */
interface Redirection {
  url: string;
  statusCode: number;
}

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

  /**
   * Validated with the frozen `InitUploadBody`, not a local variant of it. The mime allowlist is
   * enforced one layer down, in `UploadsService`, because non-membership is `415 UNSUPPORTED_TYPE`
   * rather than `400 VALIDATION_FAILED` — a distinction the upload queue branches on. CCP-8 moved
   * that rule out of the request schema so the two statements stop contradicting each other.
   */
  @Post(endpoints.uploads.init.path)
  @HttpCode(HttpStatus.CREATED)
  @Resource('node', 'parentId', 'body')
  @UseGuards(OwnerGuard)
  init(
    @Body(validate(InitUploadBody)) body: InitUploadBody,
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

  /**
   * Reading bytes back out. Both routes are declared in the *nodes* contract because that is what
   * the caller names, and implemented here because the version and its storage key are this
   * module's business.
   *
   * `ReadAccessGuard` runs to completion before the handler body starts, which is the entire
   * security property: a signed URL is minted only after access has been granted, so a denied
   * caller never causes one to exist. A 403 returned *after* minting would still have handed out a
   * URL that works for the next sixty seconds.
   */
  @Get(endpoints.nodes.content.path)
  @AllowsShareToken()
  @Resource('node')
  @UseGuards(ReadAccessGuard)
  @Header('Cache-Control', 'no-store')
  @Redirect()
  async content(@Param('id') id: string): Promise<Redirection> {
    const { url } = await this.uploads.signedUrlFor(id, 'inline');
    return { url, statusCode: HttpStatus.FOUND };
  }

  @Get(endpoints.nodes.download.path)
  @AllowsShareToken()
  @Resource('node')
  @UseGuards(ReadAccessGuard)
  @Header('Cache-Control', 'no-store')
  @Redirect()
  async download(@Param('id') id: string): Promise<Redirection> {
    const { url } = await this.uploads.signedUrlFor(id, 'attachment');
    return { url, statusCode: HttpStatus.FOUND };
  }
}
