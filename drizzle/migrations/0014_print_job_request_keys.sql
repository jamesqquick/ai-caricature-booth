ALTER TABLE print_jobs ADD COLUMN request_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS print_jobs_request_key_idx
  ON print_jobs(request_key)
  WHERE request_key IS NOT NULL;
