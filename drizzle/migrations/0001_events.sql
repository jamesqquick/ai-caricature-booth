CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  accent_color TEXT NOT NULL DEFAULT '#f6821f',
  watermark_image_key TEXT,
  watermark_image_key_left TEXT,
  tagline TEXT NOT NULL DEFAULT 'Take a selfie, pick a scene, walk away with a printed postcard.',
  kiosk_idle_subhead TEXT NOT NULL DEFAULT 'Cloudflare Kiosk',
  scene_picker_heading TEXT NOT NULL DEFAULT 'Pick your scene',
  scene_style_preamble TEXT,
  scene_constraints TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  privacy_email TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  created_by TEXT,
  watermark_w INTEGER,
  watermark_left_w INTEGER
);

INSERT OR IGNORE INTO events (
  id, slug, name, status, accent_color, tagline, kiosk_idle_subhead,
  scene_picker_heading, timezone, privacy_email, created_by
) VALUES
  (
    1,
    'nyc-tech-week-2026',
    'NY Tech Week 2026',
    'active',
    '#f6821f',
    'Take a selfie, pick an iconic NYC scene, and walk away with a printed postcard.',
    'Cloudflare · NY Tech Week 2026',
    'Pick your NYC scene',
    'America/New_York',
    'devrel@cloudflare.com',
    'local-seed'
  ),
  (
    2,
    'cloudflare-connect-2026',
    'Cloudflare Connect 2026',
    'active',
    '#f6821f',
    'Turn your conference selfie into a one-of-a-kind caricature postcard.',
    'Cloudflare · Connect 2026',
    'Pick your scene',
    'America/Los_Angeles',
    'devrel@cloudflare.com',
    'local-seed'
  );
