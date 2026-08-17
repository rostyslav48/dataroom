import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Class name composer. `clsx` resolves conditionals, `tailwind-merge` resolves conflicts, so a
 * caller-supplied `className` always wins over a component's defaults instead of depending on
 * stylesheet order.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
