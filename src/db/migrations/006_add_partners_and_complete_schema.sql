-- Migration: Add Partners table and complete schema based on Vue 3 dummy data
-- This migration ensures all tables match the data structures used in Vue 3 frontend

-- Create Tallac Partners table (matching Frappe structure)
CREATE TABLE IF NOT EXISTS tallac_partners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) UNIQUE NOT NULL, -- PART-00001 format
  partner_code VARCHAR(100) UNIQUE NOT NULL,
  partner_name VARCHAR(255) NOT NULL,
  partner_address TEXT,
  partner_city VARCHAR(100),
  partner_state VARCHAR(100),
  partner_status VARCHAR(50) DEFAULT 'Active',
  partner_email VARCHAR(255),
  partner_mobile VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create Partner Territory junction table
CREATE TABLE IF NOT EXISTS partner_territories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id UUID REFERENCES tallac_partners(id) ON DELETE CASCADE,
  territory_id UUID REFERENCES tallac_territories(id) ON DELETE CASCADE,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(partner_id, territory_id)
);

-- Add is_primary column if it doesn't exist (for existing tables)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='partner_territories' AND column_name='is_primary') THEN
    ALTER TABLE partner_territories ADD COLUMN is_primary BOOLEAN DEFAULT false;
  END IF;
END $$;

-- Create Partner Team Member table
CREATE TABLE IF NOT EXISTS partner_team_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id UUID REFERENCES tallac_partners(id) ON DELETE CASCADE,
  tallac_user_id UUID REFERENCES users(id),
  member_name VARCHAR(255),
  role VARCHAR(100),
  email VARCHAR(255),
  phone VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(partner_id, tallac_user_id)
);

-- Add missing columns to tallac_territories if they don't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_territories' AND column_name='territory_code') THEN
    ALTER TABLE tallac_territories ADD COLUMN territory_code VARCHAR(100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_territories' AND column_name='territory_dba') THEN
    ALTER TABLE tallac_territories ADD COLUMN territory_dba VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_territories' AND column_name='territory_region') THEN
    ALTER TABLE tallac_territories ADD COLUMN territory_region VARCHAR(100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_territories' AND column_name='territory_state') THEN
    ALTER TABLE tallac_territories ADD COLUMN territory_state VARCHAR(100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_territories' AND column_name='territory_status') THEN
    ALTER TABLE tallac_territories ADD COLUMN territory_status VARCHAR(50) DEFAULT 'Active';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_territories' AND column_name='territory_email') THEN
    ALTER TABLE tallac_territories ADD COLUMN territory_email VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_territories' AND column_name='territory_mobile') THEN
    ALTER TABLE tallac_territories ADD COLUMN territory_mobile VARCHAR(50);
  END IF;
END $$;

-- Add missing columns to users table for Tallac User profile
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='mobile_no') THEN
    ALTER TABLE users ADD COLUMN mobile_no VARCHAR(50);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='tallac_role') THEN
    ALTER TABLE users ADD COLUMN tallac_role VARCHAR(50);
  END IF;
END $$;

-- Ensure telephony_lines table has all required columns
DO $$ 
BEGIN
  -- Add line_name column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telephony_lines' AND column_name='line_name') THEN
    ALTER TABLE telephony_lines ADD COLUMN line_name VARCHAR(255);
    -- Update existing rows with a default value
    UPDATE telephony_lines SET line_name = 'Line ' || id::text WHERE line_name IS NULL;
    -- Make it NOT NULL after setting values
    ALTER TABLE telephony_lines ALTER COLUMN line_name SET NOT NULL;
  END IF;
  
  -- Add phone_number column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telephony_lines' AND column_name='phone_number') THEN
    ALTER TABLE telephony_lines ADD COLUMN phone_number VARCHAR(50);
  END IF;
  
  -- Add provider column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telephony_lines' AND column_name='provider') THEN
    ALTER TABLE telephony_lines ADD COLUMN provider VARCHAR(100);
  END IF;
  
  -- Add is_active column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telephony_lines' AND column_name='is_active') THEN
    ALTER TABLE telephony_lines ADD COLUMN is_active BOOLEAN DEFAULT true;
  END IF;
  
  -- Add lineNumber column (camelCase - might exist from different migration)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telephony_lines' AND column_name='lineNumber') THEN
    ALTER TABLE telephony_lines ADD COLUMN "lineNumber" VARCHAR(255);
    -- Update existing rows with line_name value
    UPDATE telephony_lines SET "lineNumber" = line_name WHERE "lineNumber" IS NULL;
  END IF;
  
  -- If lineNumber is NOT NULL, make it nullable or set default
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telephony_lines' AND column_name='lineNumber' AND is_nullable='NO') THEN
    -- Make it nullable temporarily to allow inserts
    ALTER TABLE telephony_lines ALTER COLUMN "lineNumber" DROP NOT NULL;
  END IF;
  
  -- Add phoneNumber column (camelCase - might exist from different migration)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telephony_lines' AND column_name='phoneNumber') THEN
    ALTER TABLE telephony_lines ADD COLUMN "phoneNumber" VARCHAR(50);
    -- Update existing rows with phone_number value
    UPDATE telephony_lines SET "phoneNumber" = phone_number WHERE "phoneNumber" IS NULL;
  END IF;
  
  -- If phoneNumber is NOT NULL, make it nullable
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telephony_lines' AND column_name='phoneNumber' AND is_nullable='NO') THEN
    ALTER TABLE telephony_lines ALTER COLUMN "phoneNumber" DROP NOT NULL;
  END IF;
END $$;

-- Create User Territory Assignment table
CREATE TABLE IF NOT EXISTS user_territory_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  territory_id UUID REFERENCES tallac_territories(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, territory_id)
);

-- Create User Telephony Line Assignment table
CREATE TABLE IF NOT EXISTS user_telephony_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  telephony_line_id UUID REFERENCES telephony_lines(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, telephony_line_id)
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_partners_status ON tallac_partners(partner_status);
CREATE INDEX IF NOT EXISTS idx_partners_code ON tallac_partners(partner_code);
CREATE INDEX IF NOT EXISTS idx_partner_territories_partner ON partner_territories(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_territories_territory ON partner_territories(territory_id);
CREATE INDEX IF NOT EXISTS idx_partner_team_members_partner ON partner_team_members(partner_id);
CREATE INDEX IF NOT EXISTS idx_user_territory_assignments_user ON user_territory_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_user_telephony_assignments_user ON user_telephony_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_territories_region ON tallac_territories(territory_region);
CREATE INDEX IF NOT EXISTS idx_territories_state ON tallac_territories(territory_state);

