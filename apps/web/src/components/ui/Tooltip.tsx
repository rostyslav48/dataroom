import * as Radix from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

export interface TooltipProps {
  content: string;
  children: ReactNode;
}

/**
 * Each tooltip carries its own provider so a leaf component stays testable without app-level
 * context — which is the whole point of the component tree in SPEC-07.
 *
 * A tooltip is never the only carrier of its message: callers that explain a disabled control
 * also render the same text for assistive technology, because a hover-only explanation is no
 * explanation for a keyboard or screen-reader user.
 */
export function Tooltip({ content, children }: TooltipProps): JSX.Element {
  return (
    <Radix.Provider delayDuration={200}>
      <Radix.Root>
        <Radix.Trigger asChild>{children}</Radix.Trigger>
        <Radix.Portal>
          <Radix.Content
            side="top"
            sideOffset={4}
            className="z-50 max-w-xs rounded border border-line bg-ink px-2 py-1 text-xs text-white"
          >
            {content}
          </Radix.Content>
        </Radix.Portal>
      </Radix.Root>
    </Radix.Provider>
  );
}
