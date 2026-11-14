ALTER TABLE foodprint.delivery_approvals ADD COLUMN photo_public_id TEXT, ADD COLUMN photo_hash VARCHAR(64);
ALTER TABLE foodprint.retained_food_samples ADD COLUMN photo_public_id TEXT, ADD COLUMN photo_hash VARCHAR(64);
ALTER TABLE foodprint.delivery_approvals ADD CONSTRAINT delivery_approval_photo_pair_check CHECK ((photo_public_id IS NULL) = (photo_hash IS NULL));
ALTER TABLE foodprint.retained_food_samples ADD CONSTRAINT retained_sample_photo_pair_check CHECK ((photo_public_id IS NULL) = (photo_hash IS NULL));
