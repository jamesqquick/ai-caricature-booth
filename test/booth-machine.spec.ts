import { describe, expect, it } from 'vitest';
import { boothReducer, initialBoothState } from '../src/lib/booth-machine';

describe('boothReducer', () => {
  it('starts with the first scene selected', () => {
    expect(initialBoothState.sceneId).toBe('hot-dog-stand');
    expect(boothReducer(initialBoothState, { type: 'open-camera' })).toEqual({
      step: 'camera',
      sceneId: 'hot-dog-stand',
      photoDataUrl: null,
    });
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

  it('preserves the scene when retaking a photo', () => {
    const reviewState = {
      step: 'review' as const,
      sceneId: 'broadway',
      photoDataUrl: 'data:image/jpeg;base64,test',
    };

    expect(boothReducer(reviewState, { type: 'retake' })).toEqual({
      step: 'camera',
      sceneId: 'broadway',
      photoDataUrl: null,
    });
  });

  it('moves a generated photo to review', () => {
    const generatingState = {
      step: 'generating' as const,
      sceneId: 'times-square',
      photoDataUrl: 'data:image/jpeg;base64,test',
    };

    expect(boothReducer(generatingState, { type: 'finish-generation' })).toEqual({
      ...generatingState,
      step: 'review',
    });
  });

  it('returns to scene selection without discarding the current scene', () => {
    const reviewState = {
      step: 'review' as const,
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
      step: 'review' as const,
      sceneId: 'subway',
      photoDataUrl: 'data:image/jpeg;base64,test',
    };

    expect(boothReducer(reviewState, { type: 'start-over' })).toEqual(initialBoothState);
  });
});
