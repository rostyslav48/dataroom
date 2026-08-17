import { Menu } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { UserDto } from '@dataroom/contracts';
import { Button } from '@/components/ui/Button';
import { UserMenu } from './UserMenu';

export interface TopBarProps {
  user: UserDto | null;
  roomName?: string | undefined;
  onSignOut: () => void;
  onToggleSidebar: () => void;
}

export function TopBar({ user, roomName, onSignOut, onToggleSidebar }: TopBarProps): JSX.Element {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
      <Button
        variant="ghost"
        size="sm"
        aria-label="Toggle data room list"
        className="lg:hidden"
        onClick={onToggleSidebar}
      >
        <Menu aria-hidden="true" className="h-4 w-4" />
      </Button>

      <Link to="/rooms" className="text-sm font-semibold text-ink">
        Data Room
      </Link>

      {roomName === undefined ? null : (
        <>
          <span aria-hidden="true" className="text-ink-subtle">
            /
          </span>
          <span className="truncate text-sm text-ink-muted">{roomName}</span>
        </>
      )}

      <div className="ml-auto">
        {user === null ? null : <UserMenu user={user} onSignOut={onSignOut} />}
      </div>
    </header>
  );
}
