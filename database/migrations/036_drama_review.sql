-- =====================================================================
-- 036_drama_review — ละคร AI: the storyboard stops after the (cheap) pictures so the user can check them
-- before paying for the (costly) AI clips; "อนุมัติภาพและทำวิดีโอ" sets clips_approved.
-- Applied automatically when the backend starts (AUTO_MIGRATE), or import once via phpMyAdmin.
-- =====================================================================

ALTER TABLE drama_episodes ADD COLUMN clips_approved TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'pictures checked: AI clips may be made';

-- episodes that already have clips were approved by making them
UPDATE drama_episodes e SET clips_approved = 1
 WHERE EXISTS (SELECT 1 FROM drama_shots s WHERE s.drama_project_id = e.drama_project_id AND s.episode_no = e.episode_no AND s.clip_key IS NOT NULL);
