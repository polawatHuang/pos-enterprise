-- =====================================================================
-- 033_drama_clip_length — ละคร AI: each MiniMax H3 clip is made as long as its shot's voice lines,
-- so the video moves for the whole shot instead of freezing on the still.
-- Applied automatically when the backend starts (AUTO_MIGRATE), or import once via phpMyAdmin.
-- =====================================================================

ALTER TABLE drama_shots ADD COLUMN clip_sec INT NULL COMMENT 'length the H3 clip was made for (s)';
