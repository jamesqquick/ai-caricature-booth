export type BoothStep = 'scene' | 'camera' | 'generating';

export type BoothState = {
  step: BoothStep;
  sceneId: string | null;
  photoDataUrl: string | null;
};

export type BoothAction =
  | { type: 'select-scene'; sceneId: string }
  | { type: 'open-camera' }
  | { type: 'accept-photo'; photoDataUrl: string }
  | { type: 'change-scene' }
  | { type: 'start-over'; sceneId?: string | null };

export function createInitialBoothState(sceneId: string | null): BoothState {
  return { step: 'scene', sceneId, photoDataUrl: null };
}

export const initialBoothState = createInitialBoothState(null);

export function boothReducer(state: BoothState, action: BoothAction): BoothState {
  switch (action.type) {
    case 'select-scene':
      return { ...state, sceneId: action.sceneId };
    case 'open-camera':
      return state.sceneId ? { ...state, step: 'camera', photoDataUrl: null } : state;
    case 'accept-photo':
      return state.sceneId
        ? { ...state, step: 'generating', photoDataUrl: action.photoDataUrl }
        : state;
    case 'change-scene':
      return { step: 'scene', sceneId: state.sceneId, photoDataUrl: null };
    case 'start-over':
      return createInitialBoothState(action.sceneId ?? null);
  }
}
