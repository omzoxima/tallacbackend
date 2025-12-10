-- Migration: Update tallac_organizations table with complete schema matching Tallac Organization DocType
-- This migration adds all fields from tallac/tallac/doctype/tallac_organization/tallac_organization.json

-- Add all missing columns to tallac_organizations
DO $$ 
BEGIN
  -- Basic Information Fields
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_organizations' AND column_name='doing_business_as') THEN
    ALTER TABLE tallac_organizations ADD COLUMN doing_business_as VARCHAR(255);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_organizations' AND column_name='industry') THEN
    ALTER TABLE tallac_organizations ADD COLUMN industry VARCHAR(100);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_organizations' AND column_name='organization_type') THEN
    ALTER TABLE tallac_organizations ADD COLUMN organization_type VARCHAR(50);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_organizations' AND column_name='status') THEN
    ALTER TABLE tallac_organizations ADD COLUMN status VARCHAR(50) DEFAULT 'Active';
  END IF;
  
  -- Location Fields
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_organizations' AND column_name='address_line_1') THEN
    ALTER TABLE tallac_organizations ADD COLUMN address_line_1 VARCHAR(500);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_organizations' AND column_name='address_line_2') THEN
    ALTER TABLE tallac_organizations ADD COLUMN address_line_2 VARCHAR(500);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_organizations' AND column_name='zip_code') THEN
    ALTER TABLE tallac_organizations ADD COLUMN zip_code VARCHAR(20);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_organizations' AND column_name='city') THEN
    ALTER TABLE tallac_organizations ADD COLUMN city VARCHAR(100);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_organizations' AND column_name='state') THEN
    ALTER TABLE tallac_organizations ADD COLUMN state VARCHAR(50);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_organizations' AND column_name='territory_id') THEN
    ALTER TABLE tallac_organizations ADD COLUMN territory_id UUID REFERENCES tallac_territories(id);
  END IF;
  
  -- Business Details Fields
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_organizations' AND column_name='truck_count') THEN
    ALTER TABLE tallac_organizations ADD COLUMN truck_count INTEGER;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_organizations' AND column_name='driver_count') THEN
    ALTER TABLE tallac_organizations ADD COLUMN driver_count INTEGER;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_organizations' AND column_name='employee_size') THEN
    ALTER TABLE tallac_organizations ADD COLUMN employee_size VARCHAR(50);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_organizations' AND column_name='revenue') THEN
    ALTER TABLE tallac_organizations ADD COLUMN revenue VARCHAR(50);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_organizations' AND column_name='founded_date') THEN
    ALTER TABLE tallac_organizations ADD COLUMN founded_date DATE;
  END IF;
  
  -- Contact and Notes Fields
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_organizations' AND column_name='primary_contact_id') THEN
    ALTER TABLE tallac_organizations ADD COLUMN primary_contact_id UUID REFERENCES tallac_contacts(id);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_organizations' AND column_name='overview') THEN
    ALTER TABLE tallac_organizations ADD COLUMN overview TEXT;
  END IF;
  
  -- Website and Communication
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_organizations' AND column_name='website') THEN
    ALTER TABLE tallac_organizations ADD COLUMN website VARCHAR(500);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_organizations' AND column_name='main_phone') THEN
    ALTER TABLE tallac_organizations ADD COLUMN main_phone VARCHAR(50);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_organizations' AND column_name='email') THEN
    ALTER TABLE tallac_organizations ADD COLUMN email VARCHAR(255);
  END IF;
  
  -- Ownership and Tracking
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_organizations' AND column_name='organization_owner_id') THEN
    ALTER TABLE tallac_organizations ADD COLUMN organization_owner_id UUID REFERENCES users(id);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_organizations' AND column_name='created_by_id') THEN
    ALTER TABLE tallac_organizations ADD COLUMN created_by_id UUID REFERENCES users(id);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_organizations' AND column_name='modified_by_id') THEN
    ALTER TABLE tallac_organizations ADD COLUMN modified_by_id UUID REFERENCES users(id);
  END IF;
  
  -- Rename description to overview if needed
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_organizations' AND column_name='description') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_organizations' AND column_name='overview') THEN
    ALTER TABLE tallac_organizations RENAME COLUMN description TO overview;
  END IF;
  
END $$;

-- Create table for organization social profiles (similar to Tallac Lead Social Profile)
CREATE TABLE IF NOT EXISTS tallac_organization_social_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES tallac_organizations(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL, -- Website, LinkedIn, Facebook, Twitter, Instagram, YouTube, Other
  profile_url VARCHAR(500) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, platform, profile_url)
);

-- Create table for organization associated contacts (similar to Tallac Lead Contact)
CREATE TABLE IF NOT EXISTS tallac_organization_contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES tallac_organizations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES tallac_contacts(id) ON DELETE CASCADE,
  is_primary BOOLEAN DEFAULT false,
  sequence INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, contact_id)
);

-- Create industries table
CREATE TABLE IF NOT EXISTS tallac_industries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  industry_code VARCHAR(50) UNIQUE NOT NULL,
  industry_name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_organizations_name ON tallac_organizations(organization_name);
CREATE INDEX IF NOT EXISTS idx_organizations_status ON tallac_organizations(status);
CREATE INDEX IF NOT EXISTS idx_organizations_industry ON tallac_organizations(industry);
CREATE INDEX IF NOT EXISTS idx_organizations_city ON tallac_organizations(city);
CREATE INDEX IF NOT EXISTS idx_organizations_state ON tallac_organizations(state);
CREATE INDEX IF NOT EXISTS idx_organizations_zip ON tallac_organizations(zip_code);
CREATE INDEX IF NOT EXISTS idx_organizations_territory ON tallac_organizations(territory_id);
CREATE INDEX IF NOT EXISTS idx_org_social_org_id ON tallac_organization_social_profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_contacts_org_id ON tallac_organization_contacts(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_contacts_contact_id ON tallac_organization_contacts(contact_id);

-- Create trigger to update updated_at
CREATE OR REPLACE FUNCTION update_tallac_organizations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tallac_organizations_updated_at ON tallac_organizations;
CREATE TRIGGER tallac_organizations_updated_at
  BEFORE UPDATE ON tallac_organizations
  FOR EACH ROW
  EXECUTE FUNCTION update_tallac_organizations_updated_at();

DROP TRIGGER IF EXISTS tallac_org_social_profiles_updated_at ON tallac_organization_social_profiles;
CREATE TRIGGER tallac_org_social_profiles_updated_at
  BEFORE UPDATE ON tallac_organization_social_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_tallac_organizations_updated_at();

DROP TRIGGER IF EXISTS tallac_org_contacts_updated_at ON tallac_organization_contacts;
CREATE TRIGGER tallac_org_contacts_updated_at
  BEFORE UPDATE ON tallac_organization_contacts
  FOR EACH ROW
  EXECUTE FUNCTION update_tallac_organizations_updated_at();

-- Seed some common industries
INSERT INTO tallac_industries (industry_code, industry_name, description) VALUES
  ('LOGISTICS', 'Logistics', 'Logistics and transportation companies'),
  ('TRUCKING', 'Trucking', 'Trucking and freight companies'),
  ('WAREHOUSING', 'Warehousing', 'Warehousing and storage'),
  ('SUPPLY_CHAIN', 'Supply Chain', 'Supply chain management'),
  ('FREIGHT_FORWARDING', 'Freight Forwarding', 'Freight forwarding services'),
  ('DISTRIBUTION', 'Distribution', 'Distribution and delivery services'),
  ('LAST_MILE', 'Last Mile Delivery', 'Last mile delivery services'),
  ('E_COMMERCE_LOGISTICS', 'E-commerce Logistics', 'E-commerce fulfillment and logistics'),
  ('COLD_CHAIN', 'Cold Chain', 'Temperature-controlled logistics'),
  ('PARCEL_DELIVERY', 'Parcel Delivery', 'Parcel and package delivery'),
  ('MANUFACTURING', 'Manufacturing', 'Manufacturing and production'),
  ('RETAIL', 'Retail', 'Retail and consumer goods'),
  ('TECHNOLOGY', 'Technology', 'Technology and software'),
  ('HEALTHCARE', 'Healthcare', 'Healthcare and medical'),
  ('FINANCE', 'Finance', 'Financial services'),
  ('HOSPITALITY', 'Hospitality', 'Hospitality and tourism'),
  ('REAL_ESTATE', 'Real Estate', 'Real estate and property'),
  ('CONSTRUCTION', 'Construction', 'Construction and building'),
  ('AGRICULTURE', 'Agriculture', 'Agriculture and farming'),
  ('OTHER', 'Other', 'Other industries')
ON CONFLICT (industry_code) DO NOTHING;

-- Add comment to table
COMMENT ON TABLE tallac_organizations IS 'Stores company/business organization information - matches Tallac Organization DocType from Frappe';
COMMENT ON TABLE tallac_organization_social_profiles IS 'Social media profiles and links for organizations';
COMMENT ON TABLE tallac_organization_contacts IS 'Associated contacts for organizations';
COMMENT ON TABLE tallac_industries IS 'Industry categories for organizations';

-- Update existing tallac_contacts to ensure organization linking works
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_contacts' AND column_name='organization_id') THEN
    ALTER TABLE tallac_contacts ADD COLUMN organization_id UUID REFERENCES tallac_organizations(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contacts_organization ON tallac_contacts(organization_id);

