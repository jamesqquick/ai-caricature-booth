ALTER TABLE print_jobs ADD COLUMN claim_owner TEXT;

CREATE INDEX IF NOT EXISTS print_jobs_claim_owner_status_idx
  ON print_jobs(claim_owner, status);
