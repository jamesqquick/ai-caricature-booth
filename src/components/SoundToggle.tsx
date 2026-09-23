import { useEffect, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { isSoundEnabled, setSoundEnabled } from '../lib/sound';
import { Button } from './ui/button';

export function SoundToggle() {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    setEnabled(isSoundEnabled());
  }, []);

  const toggleSound = () => {
    const nextEnabled = !enabled;
    setSoundEnabled(nextEnabled);
    setEnabled(nextEnabled);
  };

  const label = enabled ? 'Mute sound' : 'Turn sound on';

  return (
    <Button
      className="text-muted-foreground hover:text-foreground"
      variant="outline"
      size="icon"
      type="button"
      onClick={toggleSound}
      aria-label={label}
      aria-pressed={enabled}
      title={label}
    >
      {enabled ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
      <span className="sr-only">{enabled ? 'Sound is on' : 'Sound is off'}</span>
    </Button>
  );
}
