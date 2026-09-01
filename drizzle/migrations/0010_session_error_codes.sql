ALTER TABLE sessions ADD COLUMN error_code TEXT CHECK (
  error_code IN (
    'photo_rejected',
    'moderation_unavailable',
    'generation_failed',
    'composition_failed',
    'unknown_failure'
  )
);
