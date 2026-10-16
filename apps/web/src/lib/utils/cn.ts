import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge class Tailwind, loại bỏ class trùng/xung đột. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
