import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// `text-13` is a custom font size (tailwind.config.ts); without this it would be merged away as a text colour.
const twMerge = extendTailwindMerge({ extend: { classGroups: { 'font-size': [{ text: ['13'] }] } } });

/** Merge class Tailwind, loại bỏ class trùng/xung đột. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
