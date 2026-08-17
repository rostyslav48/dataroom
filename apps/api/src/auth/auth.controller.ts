import { Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { endpoints, type MeResponse, type RefreshResponse } from '@dataroom/contracts';
import { AppConfig } from '../config/app.config';
import type { GoogleIdentity } from '../users/users.service';
import { AuthService } from './auth.service';
import { GoogleAuthGuard } from './google-auth.guard';
import { CurrentIdentity, type Identity } from './identity';
import { Public } from './public.decorator';
import { returnToFromState } from './return-to';

/**
 * Routes are declared from the contract's `endpoints` rather than from string literals, so a path
 * typo is a compile error instead of a 404 found at integration.
 */
@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  /** Redirects to Google. `returnTo` is validated by the guard and packed into `state`. */
  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get(endpoints.auth.googleStart.path)
  googleStart(): void {
    // Passport issues the redirect; this body never runs.
  }

  /**
   * Sets the refresh cookie and bounces back to the web app.
   *
   * The access token is deliberately *not* put in the redirect URL — it would land in browser
   * history, in the Referer header, and in any logging proxy in between. The web app calls
   * `/auth/refresh` once on boot and holds the result in memory.
   */
  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get(endpoints.auth.googleCallback.path)
  async googleCallback(@Req() request: Request, @Res() response: Response): Promise<void> {
    const identity = request.user as GoogleIdentity;
    const { refreshToken } = await this.auth.signInWithGoogle(identity);

    this.setRefreshCookie(response, refreshToken);
    response.redirect(`${this.config.webOrigin}${returnToFromState(request.query.state)}`);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post(endpoints.auth.refresh.path)
  async refresh(@Req() request: Request, @Res() response: Response): Promise<void> {
    const presented = this.readRefreshCookie(request);
    const { session, refreshToken } = await this.auth.refresh(presented);

    this.setRefreshCookie(response, refreshToken);
    const body: RefreshResponse = session;
    response.json(body);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post(endpoints.auth.logout.path)
  async logout(@Req() request: Request, @Res() response: Response): Promise<void> {
    await this.auth.logout(this.readRefreshCookie(request));

    const { name, path, sameSite, secure } = this.config.cookie;
    response.clearCookie(name, { httpOnly: true, secure, sameSite, path });
    response.status(HttpStatus.NO_CONTENT).send();
  }

  /** 200 with the user or 401. Never 200 with a null user — the frontend branches on the status. */
  @Get(endpoints.auth.me.path)
  me(@CurrentIdentity() identity: Identity): Promise<MeResponse> {
    if (identity.kind !== 'user') {
      // Unreachable: the global guard rejects anonymous callers on a non-public endpoint. Present
      // so the type narrows without an assertion.
      return Promise.reject(new Error('anonymous identity reached /me'));
    }
    return this.auth.me(identity.userId);
  }

  private readRefreshCookie(request: Request): string | undefined {
    const cookies = request.cookies as Record<string, string> | undefined;
    return cookies?.[this.config.cookie.name];
  }

  /**
   * Host-only (no `Domain`), `httpOnly`, and cross-site in production because the web app and the
   * API sit on unrelated registrable domains. `SameSite=None` requires `Secure`, which requires
   * HTTPS — which is why local development runs `Lax` over plain HTTP instead (SPEC-02).
   */
  private setRefreshCookie(response: Response, token: string): void {
    const { name, path, sameSite, secure, maxAgeMs } = this.config.cookie;
    response.cookie(name, token, {
      httpOnly: true,
      secure,
      sameSite,
      path,
      maxAge: maxAgeMs,
    });
  }
}
