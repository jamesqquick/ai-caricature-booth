import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'cursor-pointer disabled:cursor-default aria-disabled:cursor-default disabled:pointer-events-none [&_svg]:pointer-events-none',
  {
    variants: {
      variant: {
        primary: 'border border-primary bg-primary text-primary-foreground shadow-[0_12px_35px_color-mix(in_oklch,var(--primary)_20%,transparent)] hover:-translate-y-0.5 hover:bg-primary-hover active:translate-y-0',
        secondary: 'border border-border bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground',
        outline: 'border border-border bg-transparent text-foreground hover:border-primary hover:text-primary',
        destructive: 'border border-destructive bg-destructive text-destructive-foreground hover:-translate-y-0.5 hover:bg-destructive/90 active:translate-y-0',
        destructiveOutline: 'border border-destructive/50 bg-transparent text-destructive hover:border-destructive hover:bg-destructive/10 hover:text-destructive',
        ghost: 'bg-transparent px-2 text-muted-foreground hover:text-foreground',
        contrast: 'border border-foreground bg-foreground text-background hover:-translate-y-0.5 hover:opacity-90 active:translate-y-0',
        unstyled: 'bg-transparent text-inherit',
      },
      size: {
        default: 'min-h-12 px-6 text-sm',
        sm: 'min-h-11 px-4 text-xs',
        lg: 'min-h-14 px-8 text-base',
        icon: 'size-11 p-0',
        unstyled: 'min-h-0 p-0',
      },
    },
    compoundVariants: [
      {
        variant: ['primary', 'secondary', 'outline', 'destructive', 'destructiveOutline', 'ghost', 'contrast'],
        className:
          'inline-flex items-center justify-center gap-2 rounded-full whitespace-nowrap font-bold no-underline transition-[background-color,color,opacity,transform,box-shadow] duration-200 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0',
      },
    ],
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant, size, asChild = false, ...props }, ref) {
  const Component = asChild ? Slot : 'button';

  return <Component ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
});

export { buttonVariants };
