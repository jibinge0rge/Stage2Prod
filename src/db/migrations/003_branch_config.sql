ALTER TABLE repos ADD COLUMN production_branch TEXT NOT NULL DEFAULT 'develop';
ALTER TABLE repos ADD COLUMN staging_branch TEXT NOT NULL DEFAULT 'staging';
