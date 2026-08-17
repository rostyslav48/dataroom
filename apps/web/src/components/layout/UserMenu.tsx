import { LogOut, User } from 'lucide-react';
import type { UserDto } from '@dataroom/contracts';
import { DropdownMenu } from '@/components/ui/DropdownMenu';

export interface UserMenuProps {
  user: UserDto;
  onSignOut: () => void;
}

export function UserMenu({ user, onSignOut }: UserMenuProps): JSX.Element {
  return (
    <DropdownMenu
      label={`Account menu for ${user.email}`}
      trigger={
        <button
          type="button"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink hover:bg-surface-sunken"
        >
          {user.avatarUrl === null ? (
            <User aria-hidden="true" className="h-5 w-5 rounded-full bg-surface-sunken p-0.5" />
          ) : (
            <img src={user.avatarUrl} alt="" className="h-5 w-5 rounded-full" />
          )}
          <span className="hidden sm:inline">{user.name}</span>
        </button>
      }
      items={[
        {
          key: 'signout',
          label: 'Sign out',
          icon: <LogOut aria-hidden="true" className="h-4 w-4" />,
          onSelect: onSignOut,
        },
      ]}
    />
  );
}
