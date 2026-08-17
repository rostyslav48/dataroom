import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
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

  @Public()
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
