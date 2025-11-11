-- Migration: Set all existing users password to 12345 and require password change
-- This migration sets the default password for all existing users

-- Import bcrypt functionality (we'll need to hash the password)
-- Note: This migration should be run with Node.js script that has bcrypt available
-- For now, we'll create a SQL function that can be called

-- First, let's create a function to hash password (if not exists)
-- Note: In production, this should be done via application code, not SQL
-- But for migration purposes, we'll update all users

-- Update all users to have password_change_required = true
-- This will force them to change password on next login
UPDATE users 
SET password_change_required = true
WHERE password_change_required IS NULL OR password_change_required = false;

-- Note: The actual password hash update should be done via a Node.js migration script
-- because PostgreSQL doesn't have bcrypt built-in. We'll create a separate script for this.

