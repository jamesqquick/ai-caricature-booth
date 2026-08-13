import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-bold transition-[background-color,color,opacity,transform,box-shadow] duration-200 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-[0_12px_35px_color-mix(in_oklch,var(--primary)_20%,transparent)] hover:-translate-y-0.5 hover:bg-primary-hover active:translate-y-0',
        secondary: 'border border-border bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground',
        ghost: 'bg-transparent px-2 text-muted-foreground hover:text-foreground',
      },
      size: {
        default: 'h-12',
        sm: 'min-h-11 px-4 text-xs',
        lg: 'h-14 px-8 text-base',
        icon: 'size-12 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button';

  return <Component className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { buttonVariants };
