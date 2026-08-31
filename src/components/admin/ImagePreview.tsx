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

export function ImagePreview({ src, alt, downloadHref, fullSrc = src, compact = false, showDownload = !compact }: ImagePreviewProps) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  if (status === 'error') {
    return (
      <div className={`flex items-center justify-center rounded-xl border border-dashed border-destructive/40 bg-destructive/10 text-center ${compact ? 'aspect-[3/2] min-h-16 p-2' : 'min-h-56 p-6'}`} role="alert">
        <div>
          <p className="m-0 font-label text-xs font-bold uppercase tracking-[.1em] text-destructive">{compact ? 'Unavailable' : 'Preview unavailable'}</p>
          {!compact && <p className="mb-0 mt-2 text-sm text-muted-foreground">The image could not be loaded.</p>}
          <button className={`inline-flex min-h-11 items-center rounded-full border border-destructive/50 text-sm font-bold text-foreground hover:border-destructive ${compact ? 'mt-2 px-3 text-xs' : 'mt-4 px-4'}`} type="button" onClick={() => setStatus('loading')}>
            {compact ? 'Retry' : 'Retry preview'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={`relative overflow-hidden rounded-xl border border-border bg-muted/30 ${compact ? 'aspect-[3/2]' : ''}`}>
        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground" role="status">
            Loading preview...
          </div>
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
            alt={alt}
            loading="lazy"
            className={`w-full object-contain ${compact ? 'h-full' : 'h-56'}`}
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
