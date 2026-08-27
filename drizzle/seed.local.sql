INSERT OR IGNORE INTO sessions (
  id, event_id, status, scene_id, scene_name, selfie_key, selfie_sha256,
  caricature_key, postcard_key, workflow_instance_id, created_at,
  completed_at, pipeline_ms, updated_at
) VALUES
  (
    '00000000-0000-4000-8000-000000000101', 1, 'completed', 'brooklyn-bridge',
    'Brooklyn Bridge', 'local/dummy/101-selfie.jpg', 'local-dummy-101',
    'local/dummy/101-caricature.jpg', 'local/dummy/101-postcard.jpg',
    'local-dummy-workflow-101', unixepoch() - 7200, unixepoch() - 3600,
    42000, unixepoch() - 3600
  ),
  (
    '00000000-0000-4000-8000-000000000102', 1, 'completed', 'subway',
    'Subway Platform', 'local/dummy/102-selfie.jpg', 'local-dummy-102',
    'local/dummy/102-caricature.jpg', 'local/dummy/102-postcard.jpg',
    'local-dummy-workflow-102', unixepoch() - 5400, unixepoch() - 2700,
    68000, unixepoch() - 2700
  ),
  (
    '00000000-0000-4000-8000-000000000103', 2, 'completed', 'times-square',
    'Times Square', 'local/dummy/103-selfie.jpg', 'local-dummy-103',
    'local/dummy/103-caricature.jpg', 'local/dummy/103-postcard.jpg',
    'local-dummy-workflow-103', unixepoch() - 3600, unixepoch() - 1200,
    91000, unixepoch() - 1200
  );
