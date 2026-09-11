import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

const inputVariants = cva(
  'w-full min-w-0 rounded-xl border border-input bg-background px-4 py-0 font-normal text-foreground transition-[border-color,box-shadow] file:my-[3px] file:mr-3 file:h-10 file:rounded-full file:border-0 file:bg-primary file:px-4 file:py-0 file:font-bold file:text-primary-foreground focus:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      size: {
        default: 'h-12',
        sm: 'h-11',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  },
);

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & VariantProps<typeof inputVariants>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, size, ...props }, ref) {
  return <input ref={ref} className={cn(inputVariants({ size, className }))} {...props} />;
});
