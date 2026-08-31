import { useRef, useState } from 'react';
import { PopupOverlay } from '../ui/popup-overlay';

type ImagePreviewProps = {
  src: string;
  alt: string;
  downloadHref?: string;
  fullSrc?: string;
  compact?: boolean;
  showDownload?: boolean;
};

type ImagePlaceholderProps = {
  label: string;
  compact?: boolean;
  role?: 'alert' | 'img';
  className?: string;
};

export function ImagePlaceholder({ label, compact = false, role = 'img', className = '' }: ImagePlaceholderProps) {
  return (
    <div
      className={`flex items-center justify-center rounded-xl border border-border bg-muted/30 text-muted-foreground ${compact ? 'aspect-[3/2] min-h-16 p-2' : 'min-h-56 p-6'} ${className}`}
      role={role}
      aria-label={label}
    >
      <svg className={compact ? 'size-10' : 'size-20'} viewBox="0 0 120 90" fill="none" aria-hidden="true">
        <rect x="9" y="10" width="102" height="70" rx="10" stroke="currentColor" strokeWidth="7" />
        <circle cx="82" cy="31" r="9" fill="currentColor" />
        <path d="m14 74 30-31 18 20 13-14 31 25H14Z" fill="currentColor" />
      </svg>
    </div>
  );
}

export function ImagePreview({ src, alt, downloadHref, fullSrc = src, compact = false, showDownload = !compact }: ImagePreviewProps) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  if (status === 'error') {
    return <ImagePlaceholder label={alt} compact={compact} role="alert" />;
  }

  return (
    <>
      <div className={`relative overflow-hidden rounded-xl border border-border bg-muted/30 ${compact ? 'aspect-[3/2]' : ''}`}>
        {status !== 'loaded' && (
          <ImagePlaceholder
            label={alt}
            compact={compact}
            className="absolute inset-0 z-10 border-0"
          />
        )}
        <button
          ref={triggerRef}
          type="button"
          className={`block w-full cursor-zoom-in rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 ${compact ? 'h-full min-h-16' : 'min-h-56'}`}
          onClick={() => setIsOpen(true)}
          aria-label={`Expand ${alt}`}
          disabled={status !== 'loaded'}
        >
          <img
            src={src}
            alt={status === 'loaded' ? alt : ''}
            aria-hidden={status !== 'loaded'}
            loading="lazy"
            className={`w-full object-contain transition-opacity ${compact ? 'h-full' : 'h-56'} ${status === 'loaded' ? 'opacity-100' : 'opacity-0'}`}
            onLoad={() => setStatus('loaded')}
            onError={() => setStatus('error')}
          />
        </button>
      </div>
      {showDownload && downloadHref && (
        <a className="mt-3 inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-bold text-foreground no-underline hover:border-primary hover:text-primary" href={downloadHref} download>
          Download image
        </a>
      )}
      <PopupOverlay open={isOpen} label={alt} closeLabel="Close preview" onClose={() => setIsOpen(false)} returnFocusRef={triggerRef}>
        <img src={fullSrc} alt={alt} className="max-h-[calc(100dvh-5rem)] w-full object-contain" />
      </PopupOverlay>
    </>
  );
}
