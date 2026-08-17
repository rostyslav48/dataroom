import { formatDate, formatDateTime } from '@/lib/format';

export interface NodeUpdatedCellProps {
  updatedAt: string;
}

export function NodeUpdatedCell({ updatedAt }: NodeUpdatedCellProps): JSX.Element {
  return (
    <time dateTime={updatedAt} title={formatDateTime(updatedAt)} className="text-ink-muted">
      {formatDate(updatedAt)}
    </time>
  );
}
