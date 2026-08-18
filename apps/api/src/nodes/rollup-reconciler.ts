import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { selectRows } from '../database/sql';

export interface RollupDrift {
  id: string;
  name: string;
  storedSize: string;
  storedCount: string;
  realSize: string;
  realCount: string;
}

/**
 * The one authoritative rollup recomputation used by both the nightly audit and the seed
 * invariant. A second copy would eventually make two different answers both look "correct".
 *
 * Pending uploads are deliberately absent: their placeholder nodes are invisible and contribute
 * nothing until `complete` promotes a current version and applies the rollup delta.
 */
export const ROLLUP_DRIFT_QUERY = `
  SELECT n.id,
         n.name,
         n.subtree_size_bytes::text AS "storedSize",
         n.subtree_file_count::text AS "storedCount",
         coalesce(sum(d.size_bytes), 0)::text             AS "realSize",
         count(d.id)::text                                AS "realCount"
    FROM nodes n
    LEFT JOIN nodes d
           ON d.data_room_id = n.data_room_id
          AND d.path LIKE n.path || '%'
          AND d.id <> n.id
          AND d.type = 'file'
          AND d.deleted_at IS NULL
          AND d.current_version_id IS NOT NULL
   WHERE n.type = 'folder'
     AND n.deleted_at IS NULL
   GROUP BY n.id, n.name, n.subtree_size_bytes, n.subtree_file_count
  HAVING n.subtree_size_bytes <> coalesce(sum(d.size_bytes), 0)
      OR n.subtree_file_count <> count(d.id)
   ORDER BY n.id`;

/**
 * Recomputes folder rollups from live, completed file nodes every night and reports discrepancies.
 *
 * This is intentionally an auditor rather than an automatic repair. A mismatch means one of the
 * transactional mutation paths is wrong; silently overwriting the evidence would make that defect
 * recur forever. The returned count makes the job directly testable without waiting on a clock.
 */
@Injectable()
export class RollupReconciler {
  static readonly JOB_NAME = 'nodes.reconcileRollups';

  private readonly logger = new Logger(RollupReconciler.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: RollupReconciler.JOB_NAME })
  async reconcile(): Promise<number> {
    const drift = await selectRows<RollupDrift>(this.dataSource, ROLLUP_DRIFT_QUERY);
    if (drift.length === 0) return 0;

    this.logger.warn(
      { driftCount: drift.length, nodes: drift },
      'folder rollups differ from the authoritative subtree aggregate',
    );
    return drift.length;
  }
}
