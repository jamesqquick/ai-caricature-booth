CREATE TABLE IF NOT EXISTS print_job_requests (
  idempotency_key TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  action TEXT NOT NULL,
  target_job_id TEXT REFERENCES print_jobs(id),
  result_job_id TEXT NOT NULL REFERENCES print_jobs(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS print_job_requests_session_idx
  ON print_job_requests(session_id, created_at);

-- Pre-receipt keys cannot be fingerprinted safely, so reserve them permanently.
INSERT OR IGNORE INTO print_job_requests (
  idempotency_key,
  session_id,
  action,
  target_job_id,
  result_job_id,
  created_at
)
SELECT request_key, session_id, 'legacy', id, id, created_at
FROM print_jobs
WHERE request_key IS NOT NULL;
