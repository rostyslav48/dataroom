import { Controller, Get } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { HEALTH_THROTTLE } from '../common/rate-limits';
import { Public } from '../auth/public.decorator';
import { API_VERSION } from '../version';

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  db: 'up' | 'down';
}

/**
 * `db` is a real round trip to Postgres, not a boolean captured at boot. A health check that only
 * proves Nest started is a health check that stays green while every request 500s.
 */
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  // Public *and* it runs a query, so an unauthenticated caller can convert cheap HTTP into
  // unbounded database load. Well above what any uptime prober needs, well below a load generator.
  @Public()
  @Throttle(HEALTH_THROTTLE)
  @Get()
  async check(): Promise<HealthResponse> {
    let db: 'up' | 'down' = 'down';
    try {
      await this.dataSource.query('SELECT 1');
      db = 'up';
    } catch {
      db = 'down';
    }
    return { status: db === 'up' ? 'ok' : 'degraded', version: API_VERSION, db };
  }
}
