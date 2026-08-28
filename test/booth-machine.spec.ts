import { describe, expect, it } from 'vitest';
import { boothReducer, createInitialBoothState, initialBoothState } from '../src/lib/booth-machine';

describe('boothReducer', () => {
  it('starts with the first scene selected', () => {
    const eventState = createInitialBoothState('event-first-scene');
    expect(eventState.sceneId).toBe('event-first-scene');
    expect(boothReducer(eventState, { type: 'open-camera' })).toEqual({
      step: 'camera',
      sceneId: 'event-first-scene',
      photoDataUrl: null,
    });
  });

  it('stays on scene selection when an event has no active scenes', () => {
    expect(boothReducer(createInitialBoothState(null), { type: 'open-camera' })).toEqual(initialBoothState);
  });

  it('moves from scene selection to generation after accepting a photo', () => {
    const selected = boothReducer(initialBoothState, {
      type: 'select-scene',
      sceneId: 'central-park',
    });
    const camera = boothReducer(selected, { type: 'open-camera' });
    const generating = boothReducer(camera, {
      type: 'accept-photo',
      photoDataUrl: 'data:image/jpeg;base64,test',
    });

    expect(generating).toEqual({
      step: 'generating',
      sceneId: 'central-park',
      photoDataUrl: 'data:image/jpeg;base64,test',
    });
  });

  it('returns to scene selection without discarding the current scene', () => {
    const reviewState = {
      step: 'generating' as const,
      sceneId: 'brooklyn-bridge',
      photoDataUrl: 'data:image/jpeg;base64,test',
    };

    expect(boothReducer(reviewState, { type: 'change-scene' })).toEqual({
      step: 'scene',
      sceneId: 'brooklyn-bridge',
      photoDataUrl: null,
    });
  });

  it('clears the complete flow when starting over', () => {
    const reviewState = {
      step: 'generating' as const,
      sceneId: 'subway',
      photoDataUrl: 'data:image/jpeg;base64,test',
    };

    expect(boothReducer(reviewState, { type: 'start-over' })).toEqual(initialBoothState);
  });
});
