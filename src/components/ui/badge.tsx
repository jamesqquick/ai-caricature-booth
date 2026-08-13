import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-1 font-label text-[0.625rem] font-semibold uppercase tracking-[0.14em]',
  {
    variants: {
      variant: {
        default: 'border-primary/30 bg-primary/10 text-primary',
        outline: 'border-border bg-background/60 text-muted-foreground',
        success: 'border-success/30 bg-success/10 text-success',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
