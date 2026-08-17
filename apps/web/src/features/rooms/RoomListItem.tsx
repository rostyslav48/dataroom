import { NavLink } from 'react-router-dom';
import { FolderClosed } from 'lucide-react';
import type { DataRoomDto } from '@dataroom/contracts';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';

export interface RoomListItemProps {
  room: DataRoomDto;
}

/**
 * Links to `/rooms/:id`, which resolves the room's entry node. For a room shared with you that
 * entry point is your share root, not the owner's root — the API answers with the node you may
 * actually read, so this link cannot land on a 403.
 */
export function RoomListItem({ room }: RoomListItemProps): JSX.Element {
  return (
    <li>
      <NavLink
        to={`/rooms/${room.id}`}
        className={({ isActive }) =>
          cn(
            'flex items-start gap-2 rounded-md px-2 py-2 text-sm',
            isActive ? 'bg-accent-subtle text-accent' : 'text-ink hover:bg-surface-sunken',
          )
        }
      >
        <FolderClosed aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{room.name}</span>
          <span className="block text-xs text-ink-subtle">
            {`${String(room.fileCount)} ${room.fileCount === 1 ? 'file' : 'files'} · ${formatBytes(room.sizeBytes)}`}
          </span>
          {room.access === 'viewer' ? (
            <span className="block text-xs text-ink-subtle">{`Shared by ${room.ownerName}`}</span>
          ) : null}
        </span>
      </NavLink>
    </li>
  );
}
