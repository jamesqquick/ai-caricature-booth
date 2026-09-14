import { useEffect, useState } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import {
  WATERMARK_FILE_SELECTED_EVENT,
  WATERMARK_UPLOAD_STATE_EVENT,
  type WatermarkSide,
  type WatermarkUploadStateDetail,
} from '../../lib/admin-watermark-dropzone';

type WatermarkDropzoneProps = {
  side: WatermarkSide;
  initialHasWatermark: boolean;
};

function WatermarkDropzone({ side, initialHasWatermark }: WatermarkDropzoneProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [hasWatermark, setHasWatermark] = useState(initialHasWatermark);
  const label = `${side === 'left' ? 'Left' : 'Right'} watermark`;

  useEffect(() => {
    const handleUploadState = (event: Event) => {
      const detail = (event as CustomEvent<WatermarkUploadStateDetail>).detail;
      if (!detail || detail.side !== side) return;
      setPending(detail.pending);
      if (detail.hasWatermark !== undefined) setHasWatermark(detail.hasWatermark);
      if (detail.pending) setError('');
    };

    window.addEventListener(WATERMARK_UPLOAD_STATE_EVENT, handleUploadState);
    return () => window.removeEventListener(WATERMARK_UPLOAD_STATE_EVENT, handleUploadState);
  }, [side]);

  const onDrop = (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    setError('');
    window.dispatchEvent(new CustomEvent(WATERMARK_FILE_SELECTED_EVENT, {
      detail: { side, file },
    }));
  };

  const onDropRejected = (rejections: FileRejection[]) => {
    const code = rejections[0]?.errors[0]?.code;
    setError(code === 'file-too-large' ? 'Max 2 MB.' : 'PNG files only.');
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/png': ['.png'] },
    maxFiles: 1,
    multiple: false,
    maxSize: 2 * 1024 * 1024,
    disabled: pending,
    onDrop,
    onDropRejected,
  });

  return (
    <div
      {...getRootProps({
        role: 'button',
        'aria-label': `${label}: drag and drop a PNG, or press Enter to choose one`,
        className: [
          'group absolute inset-y-0 z-10 grid w-1/2 cursor-pointer border-2 border-dashed p-3 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset',
          side === 'left' ? 'left-0 rounded-l-2xl border-l-0' : 'right-0 rounded-r-2xl border-r-0',
          isDragActive ? 'border-primary bg-primary/20' : hasWatermark ? 'border-transparent bg-transparent hover:border-primary/80 hover:bg-primary/10' : 'border-border/70 bg-background/10 hover:border-primary/80 hover:bg-primary/10',
          pending && 'cursor-wait opacity-70',
        ].filter(Boolean).join(' '),
      })}
    >
      <input {...getInputProps()} />
      <span className={[
        'rounded-xl bg-background/85 px-3 py-2 text-xs font-bold text-foreground backdrop-blur-sm transition-opacity',
        'absolute left-1/2 top-6 -translate-x-1/2',
        hasWatermark && !pending && !isDragActive && !error && 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
      ].filter(Boolean).join(' ')}>
        {pending ? `Uploading ${side}...` : isDragActive ? (hasWatermark ? 'Drop to replace' : 'Drop PNG here') : hasWatermark ? 'Replace watermark' : label}
        {!hasWatermark && !pending && !isDragActive && <span className="block font-normal text-muted-foreground">Drop or click to choose</span>}
        {error && <span className="block text-destructive">{error}</span>}
      </span>
    </div>
  );
}

type WatermarkDropzonesProps = {
  leftHasWatermark: boolean;
  rightHasWatermark: boolean;
};

export function WatermarkDropzones({ leftHasWatermark, rightHasWatermark }: WatermarkDropzonesProps) {
  return (
    <>
      <WatermarkDropzone side="left" initialHasWatermark={leftHasWatermark} />
      <WatermarkDropzone side="right" initialHasWatermark={rightHasWatermark} />
    </>
  );
}
