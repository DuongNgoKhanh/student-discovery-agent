'use client';

import * as React from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export interface IconButtonProps extends Omit<ButtonProps, 'aria-label'> {
  /** Accessible name, also shown in the tooltip unless `tooltip` overrides it. */
  label: string;
  tooltip?: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

/** Icon-only button: always named (`aria-label`) and explained by a Radix tooltip. Works as an `asChild` trigger. */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, tooltip, side, variant = 'ghost', size = 'icon', type = 'button', children, ...props }, ref) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button ref={ref} type={type} variant={variant} size={size} aria-label={label} {...props}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent side={side}>{tooltip ?? label}</TooltipContent>
    </Tooltip>
  ),
);
IconButton.displayName = 'IconButton';
