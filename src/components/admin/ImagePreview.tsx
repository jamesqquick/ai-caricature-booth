import { useRef, useState } from 'react';
import { PopupOverlay } from '../ui/popup-overlay';

type ImagePreviewProps = {
  src: string;
  alt: string;
  downloadHref: string;
};

export function ImagePreview({ src, alt, downloadHref }: ImagePreviewProps) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  if (status === 'error') {
    return (
      <div className="flex min-h-56 items-center justify-center rounded-xl border border-dashed border-destructive/40 bg-destructive/10 p-6 text-center" role="alert">
        <div>
          <p className="m-0 font-label text-xs font-bold uppercase tracking-[.1em] text-destructive">Preview unavailable</p>
          <p className="mb-0 mt-2 text-sm text-muted-foreground">The image could not be loaded.</p>
          <button className="mt-4 inline-flex min-h-11 items-center rounded-full border border-destructive/50 px-4 text-sm font-bold text-foreground hover:border-destructive" type="button" onClick={() => setStatus('loading')}>
            Retry preview
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="relative overflow-hidden rounded-xl border border-border bg-muted/30">
        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground" role="status">
            Loading preview...
          </div>
        )}
        <button
          ref={triggerRef}
          type="button"
          className="block min-h-56 w-full cursor-zoom-in rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          onClick={() => setIsOpen(true)}
          aria-label={`Expand ${alt}`}
          disabled={status !== 'loaded'}
        >
          <img
            src={src}
            alt={alt}
            loading="lazy"
            className="h-56 w-full object-contain"
            onLoad={() => setStatus('loaded')}
            onError={() => setStatus('error')}
          />
        </button>
      </div>
      <a className="mt-3 inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-bold text-foreground no-underline hover:border-primary hover:text-primary" href={downloadHref} download>
        Download image
      </a>
      <PopupOverlay open={isOpen} label={alt} closeLabel="Close preview" onClose={() => setIsOpen(false)} returnFocusRef={triggerRef}>
        <img src={src} alt={alt} className="max-h-[calc(100dvh-5rem)] w-full object-contain" />
      </PopupOverlay>
    </>
  );
}
