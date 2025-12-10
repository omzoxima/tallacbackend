-- Migration: Add updated_at column to users table if it doesn't exist
-- This ensures the updated_at column exists for password change and user updates

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'updated_at') THEN
    ALTER TABLE users ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    -- Set updated_at to created_at for existing rows
    UPDATE users SET updated_at = created_at WHERE updated_at IS NULL AND created_at IS NOT NULL;
    -- Set updated_at to current timestamp if created_at is also null
    UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL;
  END IF;
END $$;

