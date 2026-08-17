import * as Radix from '@radix-ui/react-dropdown-menu';
import { useRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface MenuItemSpec {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
  /**
   * The action puts focus somewhere else — an inline edit field, say. Radix otherwise returns
   * focus to the trigger as the menu closes, which would blur that field the instant it opened.
   */
  movesFocus?: boolean;
}

export interface DropdownMenuProps {
  trigger: ReactNode;
  items: MenuItemSpec[];
  /** Accessible name for the trigger; menus in a table row all look alike otherwise. */
  label: string;
}

export function DropdownMenu({ trigger, items, label }: DropdownMenuProps): JSX.Element {
  const focusMovedRef = useRef(false);

  return (
    <Radix.Root>
      <Radix.Trigger asChild aria-label={label}>
        {trigger}
      </Radix.Trigger>
      <Radix.Portal>
        <Radix.Content
          align="end"
          sideOffset={4}
          onCloseAutoFocus={(event) => {
            if (focusMovedRef.current) {
              focusMovedRef.current = false;
              event.preventDefault();
            }
          }}
          className="z-50 min-w-[10rem] rounded-md border border-line bg-surface p-1 shadow-lg animate-fade-in"
        >
          {items.map((item) => (
            <Radix.Item
              key={item.key}
              onSelect={() => {
                focusMovedRef.current = item.movesFocus === true;
                item.onSelect();
              }}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none',
                'data-[highlighted]:bg-surface-sunken',
                item.destructive === true ? 'text-danger' : 'text-ink',
              )}
            >
              {item.icon}
              {item.label}
            </Radix.Item>
          ))}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
