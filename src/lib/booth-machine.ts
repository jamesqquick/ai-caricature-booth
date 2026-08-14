export type BoothStep = 'scene' | 'camera' | 'generating' | 'review';

export type BoothState = {
  step: BoothStep;
  sceneId: string | null;
  photoDataUrl: string | null;
  postcardUrl: string | null;
};

export type BoothAction =
  | { type: 'select-scene'; sceneId: string }
  | { type: 'open-camera' }
  | { type: 'accept-photo'; photoDataUrl: string }
  | { type: 'finish-generation'; postcardUrl: string }
  | { type: 'retake' }
  | { type: 'change-scene' }
  | { type: 'start-over' };

export const initialBoothState: BoothState = {
  step: 'scene',
  sceneId: 'hot-dog-stand',
  photoDataUrl: null,
  postcardUrl: null,
};

export function boothReducer(state: BoothState, action: BoothAction): BoothState {
  switch (action.type) {
    case 'select-scene':
      return { ...state, sceneId: action.sceneId };
    case 'open-camera':
      return state.sceneId ? { ...state, step: 'camera', photoDataUrl: null } : state;
    case 'accept-photo':
      return state.sceneId
        ? { ...state, step: 'generating', photoDataUrl: action.photoDataUrl, postcardUrl: null }
        : state;
    case 'finish-generation':
      return state.photoDataUrl ? { ...state, step: 'review', postcardUrl: action.postcardUrl } : state;
    case 'retake':
      return state.sceneId ? { ...state, step: 'camera', photoDataUrl: null, postcardUrl: null } : initialBoothState;
    case 'change-scene':
      return { step: 'scene', sceneId: state.sceneId, photoDataUrl: null, postcardUrl: null };
    case 'start-over':
      return initialBoothState;
  }
}
