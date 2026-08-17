import { Logger } from '@nestjs/common';
import { inject } from 'vitest';

// Tests assert on responses, not on log lines; Nest's logger would otherwise interleave a wall of
// expected warnings with the reporter's output and hide the real failures.
Logger.overrideLogger(false);

/**
 * Every test worker gets the same environment the application expects, pointed at the throwaway
 * container from `global-setup.ts`. Nothing here is a test-only code path in the app itself: the
 * app reads exactly the variables it reads in production.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = inject('databaseUrl');
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_CALLBACK_URL = 'http://localhost:3000/api/v1/auth/google/callback';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-000000000000000000';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-00000000000000000';
process.env.ACCESS_TOKEN_TTL = '15m';
process.env.REFRESH_TOKEN_TTL = '30d';
process.env.COOKIE_SAMESITE = 'lax';
process.env.COOKIE_SECURE = 'false';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.SUPABASE_BUCKET = 'dataroom-test';
process.env.MAX_UPLOAD_BYTES = '104857600';
process.env.WEB_ORIGIN = 'http://localhost:5173';
