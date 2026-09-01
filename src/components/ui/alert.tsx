import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Alert({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('relative w-full rounded-2xl border p-4 text-sm', className)}
      role="alert"
      {...props}
    />
  );
}

export const AlertTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(function AlertTitle({ className, ...props }, ref) {
  return <h3 ref={ref} className={cn('font-semibold leading-none tracking-tight', className)} {...props} />;
});

export function AlertDescription({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-1 text-sm [&_p]:leading-relaxed', className)} {...props} />;
}
