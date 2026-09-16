import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmationDialog } from '../ui/confirmation-dialog';

export const SCENE_DELETE_REQUEST_EVENT = 'scene-delete-requested';
export const SCENE_DELETED_EVENT = 'scene-deleted';

export type SceneDeleteRequestDetail = {
  endpoint: string;
  sceneId: string;
  sceneName: string;
  trigger: HTMLElement;
};

type DeleteSceneResult = {
  error?: string;
  sceneId?: string;
};

class SceneDeletionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SceneDeletionError';
  }
}

export function SceneDeleteDialog() {
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [target, setTarget] = useState<SceneDeleteRequestDetail | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const handleRequest = (event: Event) => {
      const detail = (event as CustomEvent<SceneDeleteRequestDetail>).detail;
      if (!detail || !detail.endpoint || !detail.sceneId || !detail.sceneName) return;
      returnFocusRef.current = detail.trigger;
      setError('');
      setTarget(detail);
    };
    window.addEventListener(SCENE_DELETE_REQUEST_EVENT, handleRequest);
    return () => window.removeEventListener(SCENE_DELETE_REQUEST_EVENT, handleRequest);
  }, []);

  const deleteScene = async () => {
    if (!target) return;
    setPending(true);
    setError('');
    try {
      const response = await fetch(target.endpoint, { method: 'DELETE' });
      const result = await response.json<DeleteSceneResult>().catch((): DeleteSceneResult => ({}));
      if (!response.ok) throw new SceneDeletionError(result.error ?? "Couldn't delete the scene. Try again.");
      window.dispatchEvent(new CustomEvent(SCENE_DELETED_EVENT, {
        detail: { sceneId: result.sceneId ?? target.sceneId },
      }));
      toast.success('Scene deleted.');
      setTarget(null);
    } catch (cause) {
      setError(cause instanceof SceneDeletionError ? cause.message : "Couldn't delete the scene. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <ConfirmationDialog
      open={Boolean(target)}
      title={`Delete ${target?.sceneName ?? 'scene'}`}
      confirmLabel="Permanently delete scene"
      pendingLabel="Deleting scene..."
      pending={pending}
      error={error}
      returnFocusRef={returnFocusRef}
      onClose={() => setTarget(null)}
      onConfirm={deleteScene}
    >
      <p className="m-0">This permanently deletes <strong className="text-foreground">{target?.sceneName}</strong>. Existing sessions keep their saved scene details. This cannot be undone.</p>
    </ConfirmationDialog>
  );
}
