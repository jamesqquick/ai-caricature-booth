import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, RotateCcw } from 'lucide-react';
import { Button } from '../ui/button';

type CameraStatus = 'starting' | 'live' | 'countdown' | 'preview' | 'error';

type Props = {
  onUsePhoto: (photoDataUrl: string) => void;
};

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

export function CameraStep({ onUsePhoto }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureRunRef = useRef(0);
  const [status, setStatus] = useState<CameraStatus>('starting');
  const [errorMessage, setErrorMessage] = useState('');
  const [countdown, setCountdown] = useState<number | null>(null);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [cameraRun, setCameraRun] = useState(0);

  useEffect(() => {
    let active = true;

    async function startCamera() {
      setStatus('starting');
      setErrorMessage('');

      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('error');
        setErrorMessage('Camera access is not supported here. Open this page on localhost or HTTPS.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } },
          audio: false,
        });

        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setStatus('live');
      } catch (error) {
        if (!active) return;
        stopCamera();
        const denied = error instanceof DOMException && error.name === 'NotAllowedError';
        setErrorMessage(
          denied
            ? 'Camera access was blocked. Allow camera access in your browser settings, then try again.'
            : 'We could not start the camera. Make sure another app is not using it, then try again.',
        );
        setStatus('error');
      }
    }

    void startCamera();

    return () => {
      active = false;
      captureRunRef.current += 1;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [cameraRun]);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function showCameraError(message: string) {
    captureRunRef.current += 1;
    stopCamera();
    setCountdown(null);
    setErrorMessage(message);
    setStatus('error');
  }

  function captureFrame() {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight) {
      showCameraError('The camera did not return a usable frame. Please try again.');
      return;
    }

    const canvas = document.createElement('canvas');
    const outputWidth = 720;
    const outputHeight = 900;
    const targetRatio = outputWidth / outputHeight;
    const sourceRatio = video.videoWidth / video.videoHeight;
    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = video.videoWidth;
    let sourceHeight = video.videoHeight;

    if (sourceRatio > targetRatio) {
      sourceWidth = video.videoHeight * targetRatio;
      sourceX = (video.videoWidth - sourceWidth) / 2;
    } else {
      sourceHeight = video.videoWidth / targetRatio;
      sourceY = (video.videoHeight - sourceHeight) / 2;
    }

    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      showCameraError('This browser could not prepare the photo. Please try another browser.');
      return;
    }

    context.translate(outputWidth, 0);
    context.scale(-1, 1);
    context.drawImage(
      video,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      outputWidth,
      outputHeight,
    );

    setPhotoDataUrl(canvas.toDataURL('image/jpeg', 0.8));
    stopCamera();
    setCountdown(null);
    setStatus('preview');
  }

  async function beginCountdown() {
    if (status !== 'live') return;
    const run = captureRunRef.current + 1;
    captureRunRef.current = run;
    setStatus('countdown');

    for (const value of [3, 2, 1]) {
      if (captureRunRef.current !== run) return;
      setCountdown(value);
      await wait(700);
    }

    if (captureRunRef.current === run) captureFrame();
  }

  function retake() {
    captureRunRef.current += 1;
    setCountdown(null);
    setPhotoDataUrl(null);
    setCameraRun((run) => run + 1);
  }

  return (
    <div className="step-enter w-full max-w-[64rem]">
      <div className="flex flex-col items-center gap-4">
        <div className="relative aspect-[4/5] w-full max-w-[34rem] justify-self-center overflow-hidden rounded-[clamp(1.2rem,3vw,2rem)] border border-border bg-card">
          <video className="size-full object-cover scale-x-[-1]" ref={videoRef} playsInline muted autoPlay hidden={status === 'preview'} />
          {photoDataUrl && <img className="size-full object-cover" src={photoDataUrl} alt="Your captured photo" />}
          <div className="pointer-events-none absolute inset-[16%_18%] rounded-[48%_48%_44%_44%] border border-dashed border-foreground/55" aria-hidden="true" />
          <span className="absolute left-4 top-4 size-9 border-l-[3px] border-t-[3px] border-solid border-primary" aria-hidden="true" />
          <span className="absolute bottom-4 right-4 size-9 border-b-[3px] border-r-[3px] border-solid border-primary" aria-hidden="true" />

          {status === 'starting' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[oklch(13%_.015_55_/.88)] p-8 text-center">
              <span className="size-10 animate-spin rounded-full border-[3px] border-foreground/15 border-t-primary" aria-hidden="true" />
              <strong>Starting camera</strong>
              <small className="max-w-[31ch] leading-6 text-foreground/80">Choose Allow if your browser asks for permission.</small>
            </div>
          )}
          {status === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[oklch(13%_.015_55_/.88)] p-8 text-center">
              <span className="grid size-12 place-items-center rounded-full border-2 border-danger text-danger" aria-hidden="true"><AlertCircle /></span>
              <strong>Camera unavailable</strong>
              <small className="max-w-[31ch] leading-6 text-foreground/80">{errorMessage}</small>
              <Button variant="secondary" type="button" onClick={() => setCameraRun((run) => run + 1)}>
                Try again
              </Button>
            </div>
          )}
          {status === 'countdown' && <div className="absolute inset-0 flex items-center justify-center bg-[oklch(13%_.015_55_/.38)] font-display text-[clamp(7rem,20vw,13rem)] font-semibold leading-none text-center text-shadow-[0_0_2rem_oklch(95%_.015_75_/.4)]" aria-label={`Photo in ${countdown}`}>{countdown}</div>}
        </div>

        <div className="flex flex-col items-center justify-center text-center">
          {status !== 'preview' ? (
            <>
              <button
                className="relative mb-5 size-[clamp(5.4rem,10vw,7rem)] rounded-full border-[7px] border-foreground bg-primary shadow-[0_0_0_7px_oklch(95%_.015_75_/.12)] transition-transform duration-150 hover:enabled:scale-[1.04] active:enabled:scale-95 disabled:cursor-wait disabled:opacity-30"
                type="button"
                disabled={status !== 'live'}
                onClick={() => void beginCountdown()}
              >
                <span className="sr-only">Take photo</span>
              </button>
            </>
          ) : (
            <div className="flex w-full max-w-xs flex-col gap-3">
              <Button type="button" onClick={() => photoDataUrl && onUsePhoto(photoDataUrl)}>
                Use this photo <ArrowRight aria-hidden="true" />
              </Button>
              <Button variant="secondary" type="button" onClick={retake}>
                <RotateCcw aria-hidden="true" /> Retake
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
