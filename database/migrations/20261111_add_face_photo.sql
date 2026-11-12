-- Apply once to databases created before face-photo capture was added.
ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS face_photo TEXT;
