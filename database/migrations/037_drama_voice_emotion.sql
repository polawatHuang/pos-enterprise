-- =====================================================================
-- 037_drama_voice_emotion — ละคร AI: the narrator's tone per shot (MiniMax TTS emotion: calm, sad, …);
-- character lines carry their own emotion inside drama_shots.dialogue (JSON).
-- Applied automatically when the backend starts (AUTO_MIGRATE), or import once via phpMyAdmin.
-- =====================================================================

ALTER TABLE drama_shots ADD COLUMN narration_emotion VARCHAR(20) NULL COMMENT 'TTS emotion of the narration';
