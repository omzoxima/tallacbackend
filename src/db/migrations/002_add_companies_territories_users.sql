-- Migration: Add Companies, Territories with Owners and Zip Codes, User enhancements
-- This migration adds support for Companies, enhanced Territories, and User management

-- Add password_change_required and last_password_change to users table
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='password_change_required') THEN
    ALTER TABLE users ADD COLUMN password_change_required BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='last_password_change') THEN
    ALTER TABLE users ADD COLUMN last_password_change TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='reports_to_id') THEN
    ALTER TABLE users ADD COLUMN reports_to_id UUID REFERENCES users(id);
  END IF;
END $$;

-- Update tallac_territories table with additional fields
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_territories' AND column_name='doing_business_as') THEN
    ALTER TABLE tallac_territories ADD COLUMN doing_business_as VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_territories' AND column_name='status') THEN
    ALTER TABLE tallac_territories ADD COLUMN status VARCHAR(50) DEFAULT 'Active';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_territories' AND column_name='territory_owner') THEN
    ALTER TABLE tallac_territories ADD COLUMN territory_owner VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_territories' AND column_name='mobile') THEN
    ALTER TABLE tallac_territories ADD COLUMN mobile VARCHAR(50);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_territories' AND column_name='address') THEN
    ALTER TABLE tallac_territories ADD COLUMN address TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_territories' AND column_name='territory_manager_email') THEN
    ALTER TABLE tallac_territories ADD COLUMN territory_manager_email VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_territories' AND column_name='email') THEN
    ALTER TABLE tallac_territories ADD COLUMN email VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_territories' AND column_name='map_address') THEN
    ALTER TABLE tallac_territories ADD COLUMN map_address VARCHAR(500);
  END IF;
END $$;

-- Create territory_owners table (many-to-many relationship)
CREATE TABLE IF NOT EXISTS territory_owners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  territory_id UUID REFERENCES tallac_territories(id) ON DELETE CASCADE,
  owner_name VARCHAR(255) NOT NULL,
  owner_email VARCHAR(255),
  owner_phone VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(territory_id, owner_name)
);

-- Create territory_zip_codes table (many-to-many relationship)
CREATE TABLE IF NOT EXISTS territory_zip_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  territory_id UUID REFERENCES tallac_territories(id) ON DELETE CASCADE,
  zip_code VARCHAR(20) NOT NULL,
  city VARCHAR(100),
  state VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(territory_id, zip_code)
);

-- Create or ensure companies table exists with all required columns
DO $$ 
BEGIN
  -- Create table if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'companies') THEN
    CREATE TABLE companies (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_name VARCHAR(255) NOT NULL,
      doing_business_as VARCHAR(255),
      industry VARCHAR(100),
      status VARCHAR(50) DEFAULT 'Active',
      
      -- Contact Information
      territory_owner VARCHAR(255),
      mobile VARCHAR(50),
      address TEXT,
      territory_manager_email VARCHAR(255),
      email VARCHAR(255),
      map_address VARCHAR(500),
      
      -- Location
      full_address TEXT,
      location_summary TEXT,
      zip_code VARCHAR(20),
      city VARCHAR(100),
      state VARCHAR(100),
      territory_id UUID,
      
      -- Business Details
      truck_count INTEGER,
      driver_count INTEGER,
      employee_count INTEGER,
      annual_revenue DECIMAL(15, 2),
      years_in_business INTEGER,
      business_type VARCHAR(50),
      
      -- Organization reference
      organization_id UUID,
      
      -- System
      created_by_id UUID,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  ELSE
    -- Table exists, add missing columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'company_name') THEN
      ALTER TABLE companies ADD COLUMN company_name VARCHAR(255);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'doing_business_as') THEN
      ALTER TABLE companies ADD COLUMN doing_business_as VARCHAR(255);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'industry') THEN
      ALTER TABLE companies ADD COLUMN industry VARCHAR(100);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'status') THEN
      ALTER TABLE companies ADD COLUMN status VARCHAR(50) DEFAULT 'Active';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'territory_owner') THEN
      ALTER TABLE companies ADD COLUMN territory_owner VARCHAR(255);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'mobile') THEN
      ALTER TABLE companies ADD COLUMN mobile VARCHAR(50);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'address') THEN
      ALTER TABLE companies ADD COLUMN address TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'territory_manager_email') THEN
      ALTER TABLE companies ADD COLUMN territory_manager_email VARCHAR(255);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'email') THEN
      ALTER TABLE companies ADD COLUMN email VARCHAR(255);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'map_address') THEN
      ALTER TABLE companies ADD COLUMN map_address VARCHAR(500);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'full_address') THEN
      ALTER TABLE companies ADD COLUMN full_address TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'location_summary') THEN
      ALTER TABLE companies ADD COLUMN location_summary TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'zip_code') THEN
      ALTER TABLE companies ADD COLUMN zip_code VARCHAR(20);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'city') THEN
      ALTER TABLE companies ADD COLUMN city VARCHAR(100);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'state') THEN
      ALTER TABLE companies ADD COLUMN state VARCHAR(100);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'territory_id') THEN
      ALTER TABLE companies ADD COLUMN territory_id UUID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'truck_count') THEN
      ALTER TABLE companies ADD COLUMN truck_count INTEGER;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'driver_count') THEN
      ALTER TABLE companies ADD COLUMN driver_count INTEGER;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'employee_count') THEN
      ALTER TABLE companies ADD COLUMN employee_count INTEGER;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'annual_revenue') THEN
      ALTER TABLE companies ADD COLUMN annual_revenue DECIMAL(15, 2);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'years_in_business') THEN
      ALTER TABLE companies ADD COLUMN years_in_business INTEGER;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'business_type') THEN
      ALTER TABLE companies ADD COLUMN business_type VARCHAR(50);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'organization_id') THEN
      ALTER TABLE companies ADD COLUMN organization_id UUID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'created_by_id') THEN
      ALTER TABLE companies ADD COLUMN created_by_id UUID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'created_at') THEN
      ALTER TABLE companies ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'updated_at') THEN
      ALTER TABLE companies ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    END IF;
    
    -- Make company_name NOT NULL if it exists and can be made NOT NULL
    BEGIN
      ALTER TABLE companies ALTER COLUMN company_name SET NOT NULL;
    EXCEPTION WHEN OTHERS THEN
      -- If there are null values, we can't set NOT NULL
      NULL;
    END;
  END IF;
END $$;

-- Add foreign key constraints if tables exist
DO $$ 
BEGIN
  -- Add foreign key for territory_id if tallac_territories exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tallac_territories') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE table_name = 'companies' 
      AND constraint_name = 'companies_territory_id_fkey'
    ) THEN
      ALTER TABLE companies ADD CONSTRAINT companies_territory_id_fkey 
      FOREIGN KEY (territory_id) REFERENCES tallac_territories(id);
    END IF;
  END IF;

  -- Add foreign key for organization_id if tallac_organizations exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tallac_organizations') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE table_name = 'companies' 
      AND constraint_name = 'companies_organization_id_fkey'
    ) THEN
      ALTER TABLE companies ADD CONSTRAINT companies_organization_id_fkey 
      FOREIGN KEY (organization_id) REFERENCES tallac_organizations(id);
    END IF;
  END IF;

  -- Add foreign key for created_by_id if users exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE table_name = 'companies' 
      AND constraint_name = 'companies_created_by_id_fkey'
    ) THEN
      ALTER TABLE companies ADD CONSTRAINT companies_created_by_id_fkey 
      FOREIGN KEY (created_by_id) REFERENCES users(id);
    END IF;
  END IF;
END $$;

-- Create indexes (only if tables and columns exist)
DO $$ 
BEGIN
  -- Index for territory_owners
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'territory_owners') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_territory_owners_territory') THEN
      CREATE INDEX idx_territory_owners_territory ON territory_owners(territory_id);
    END IF;
  END IF;

  -- Index for territory_zip_codes
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'territory_zip_codes') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_territory_zip_codes_territory') THEN
      CREATE INDEX idx_territory_zip_codes_territory ON territory_zip_codes(territory_id);
    END IF;
  END IF;

  -- Indexes for companies (check if table and columns exist)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'companies') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'company_name') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_companies_company_name') THEN
        CREATE INDEX idx_companies_company_name ON companies(company_name);
      END IF;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'territory_id') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_companies_territory') THEN
        CREATE INDEX idx_companies_territory ON companies(territory_id);
      END IF;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'status') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_companies_status') THEN
        CREATE INDEX idx_companies_status ON companies(status);
      END IF;
    END IF;
  END IF;

  -- Index for users.reports_to_id
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'reports_to_id') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_users_reports_to') THEN
      CREATE INDEX idx_users_reports_to ON users(reports_to_id);
    END IF;
  END IF;
END $$;

-- Update existing territories to set status if not set
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tallac_territories' AND column_name = 'status') THEN
    UPDATE tallac_territories SET status = 'Active' WHERE status IS NULL;
  END IF;
END $$;

