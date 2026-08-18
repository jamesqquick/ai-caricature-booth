export const soundPreferenceKey = 'booth-sound-enabled';

type AudioContextConstructor = typeof AudioContext;

let audioContext: AudioContext | null = null;

export function soundEnabledFromStoredValue(value: string | null) {
  return value !== 'false';
}

export function isSoundEnabled() {
  try {
    return soundEnabledFromStoredValue(window.localStorage.getItem(soundPreferenceKey));
  } catch {
    return true;
  }
}

export function setSoundEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(soundPreferenceKey, String(enabled));
  } catch {
    // Audio remains available for the current page when storage is restricted.
  }
}

function getAudioContext() {
  if (audioContext) return audioContext;

  const AudioContextClass = window.AudioContext ?? (window as Window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
  if (!AudioContextClass) return null;

  audioContext = new AudioContextClass();
  return audioContext;
}

function withAudioContext(callback: (context: AudioContext) => void) {
  if (!isSoundEnabled()) return;

  try {
    const context = getAudioContext();
    if (!context) return;

    void context.resume().then(() => {
      if (isSoundEnabled()) callback(context);
    }).catch(() => undefined);
  } catch {
    // Web Audio is optional and must never interrupt photo capture.
  }
}

export function playCountdownTick() {
  withAudioContext((context) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime;

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(720, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.12, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.11);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.12);
  });
}
