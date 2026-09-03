ALTER TABLE print_jobs ADD COLUMN claim_token TEXT;

CREATE INDEX IF NOT EXISTS print_jobs_session_status_idx
  ON print_jobs(session_id, status, created_at);
