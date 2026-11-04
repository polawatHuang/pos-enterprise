-- =====================================================================
-- 035_drama_series — ละคร AI becomes a series: a story of N episodes (e.g. 16 ตอนจบ), each its own
-- 9:16 video. Characters, cover, style and tie-in are shared by the series; script, shots and the
-- finished video belong to an episode. Every shot is a moving MiniMax H3 clip (no still slides).
-- Applied automatically when the backend starts (AUTO_MIGRATE), or import once via phpMyAdmin.
-- =====================================================================

ALTER TABLE drama_projects
  ADD COLUMN episodes_total INT NOT NULL DEFAULT 1 COMMENT 'number of episodes in the series',
  ADD COLUMN run_episode    INT NULL COMMENT 'episode the current run works on';

CREATE TABLE IF NOT EXISTS drama_episodes (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  drama_project_id BIGINT UNSIGNED NOT NULL,
  episode_no       INT NOT NULL,
  title            VARCHAR(255) NULL,
  summary          TEXT NULL COMMENT 'what happens in this episode (series outline)',
  cliffhanger      TEXT NULL COMMENT 'how the episode ends, leading into the next',
  render_id        VARCHAR(100) NULL,
  output_key       VARCHAR(80) NULL,
  output_url       VARCHAR(1000) NULL,
  subtitle_srt     MEDIUMTEXT NULL,
  duration_sec     INT NULL,
  UNIQUE KEY uq_drama_episode (drama_project_id, episode_no),
  CONSTRAINT fk_drama_episode_project FOREIGN KEY (drama_project_id) REFERENCES drama_projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE drama_shots
  ADD COLUMN episode_no    INT NOT NULL DEFAULT 1,
  ADD COLUMN clip_attempts INT NOT NULL DEFAULT 0 COMMENT 'failed H3 attempts (retried automatically up to 3)',
  ADD KEY idx_drama_shot_episode (drama_project_id, episode_no, seq);

-- Projects made so far become one-episode series; their finished video stays as episode 1
INSERT IGNORE INTO drama_episodes (drama_project_id, episode_no, title, summary, render_id, output_key, output_url, subtitle_srt, duration_sec)
  SELECT id, 1, title, logline, render_id, output_key, output_url, subtitle_srt, duration_sec FROM drama_projects;

-- No more still-image slides: every shot is a moving clip; shots without one get a clip on the next run
UPDATE drama_projects SET visual_mode = 'clips';
UPDATE drama_shots SET kind = 'clip', clip_status = IF(clip_key IS NULL, 'pending', 'done'), clip_polls = 0 WHERE kind = 'still' OR (clip_key IS NULL AND clip_status <> 'processing');
