-- Tallac CRM Database Schema
-- PostgreSQL Migration Script

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (simplified from Frappe User)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  full_name VARCHAR(255),
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'Sales User',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add columns if they don't exist (for existing tables)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='first_name') THEN
    ALTER TABLE users ADD COLUMN first_name VARCHAR(100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='last_name') THEN
    ALTER TABLE users ADD COLUMN last_name VARCHAR(100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='full_name') THEN
    ALTER TABLE users ADD COLUMN full_name VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='password_hash') THEN
    ALTER TABLE users ADD COLUMN password_hash VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='role') THEN
    ALTER TABLE users ADD COLUMN role VARCHAR(50) DEFAULT 'Sales User';
  ELSE
    -- If role exists as enum, try to convert it to VARCHAR
    BEGIN
      ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(50) USING role::text;
    EXCEPTION WHEN OTHERS THEN
      -- If conversion fails, just continue
      NULL;
    END;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='is_active') THEN
    ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='created_at') THEN
    ALTER TABLE users ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='updated_at') THEN
    ALTER TABLE users ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
  END IF;
  -- Update full_name for existing rows
  UPDATE users SET full_name = COALESCE(first_name || ' ' || last_name, first_name, last_name, email) WHERE full_name IS NULL;
END $$;

-- Tallac Territories
CREATE TABLE IF NOT EXISTS tallac_territories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  territory_name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tallac Organizations
CREATE TABLE IF NOT EXISTS tallac_organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tallac Contacts
CREATE TABLE IF NOT EXISTS tallac_contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  job_title VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  mobile VARCHAR(50),
  fax VARCHAR(50),
  organization_id UUID REFERENCES tallac_organizations(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tallac Leads (Prospects)
CREATE TABLE IF NOT EXISTS tallac_leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) UNIQUE NOT NULL, -- TLEAD-00001 format
  organization_id UUID REFERENCES tallac_organizations(id),
  company_name VARCHAR(255) NOT NULL,
  doing_business_as VARCHAR(255),
  industry VARCHAR(100),
  
  -- Status and Assignment
  status VARCHAR(50) DEFAULT 'New',
  lead_owner_id UUID REFERENCES users(id),
  assigned_to_id UUID REFERENCES users(id),
  assigned_date DATE,
  source VARCHAR(50),
  
  -- Primary Contact
  primary_contact_id UUID REFERENCES tallac_contacts(id),
  primary_contact_name VARCHAR(255),
  primary_title VARCHAR(255),
  primary_phone VARCHAR(50),
  primary_email VARCHAR(255),
  primary_mobile VARCHAR(50),
  primary_fax VARCHAR(50),
  
  -- Location
  full_address TEXT,
  location_summary TEXT,
  zip_code VARCHAR(20),
  city VARCHAR(100),
  state VARCHAR(100),
  territory_id UUID REFERENCES tallac_territories(id),
  
  -- Business Details
  truck_count INTEGER,
  driver_count INTEGER,
  employee_count INTEGER,
  annual_revenue DECIMAL(15, 2),
  years_in_business INTEGER,
  business_type VARCHAR(50),
  
  -- Sales Activity
  last_activity_summary TEXT,
  last_call_date TIMESTAMP,
  last_call_outcome VARCHAR(50),
  last_notes TEXT,
  callback_date DATE,
  callback_time TIME,
  next_action VARCHAR(50),
  
  -- Notes
  internal_notes TEXT,
  
  -- System
  imported_on TIMESTAMP,
  created_by_role VARCHAR(50),
  created_by_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tallac Lead Contacts (Additional Contacts)
CREATE TABLE IF NOT EXISTS tallac_lead_contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES tallac_leads(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES tallac_contacts(id),
  contact_name VARCHAR(255),
  title VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  mobile VARCHAR(50),
  sequence INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tallac Lead Contact Path
CREATE TABLE IF NOT EXISTS tallac_lead_contact_paths (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES tallac_leads(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES tallac_contacts(id),
  contact_name VARCHAR(255),
  status VARCHAR(50),
  sequence INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tallac Lead Social Profiles
CREATE TABLE IF NOT EXISTS tallac_lead_social_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES tallac_leads(id) ON DELETE CASCADE,
  platform VARCHAR(50),
  url VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Activity Status
CREATE TABLE IF NOT EXISTS activity_statuses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  status_name VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tallac Activities (Callbacks & Appointments)
CREATE TABLE IF NOT EXISTS tallac_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) UNIQUE NOT NULL, -- TACT-00001 format
  activity_type VARCHAR(50) NOT NULL, -- Callback or Appointment
  title VARCHAR(255),
  status_id UUID REFERENCES activity_statuses(id),
  priority VARCHAR(20) DEFAULT 'Medium',
  
  -- Schedule
  scheduled_date DATE NOT NULL,
  scheduled_time TIME NOT NULL,
  due_date DATE,
  due_time TIME,
  
  -- Assignment
  assigned_to_id UUID REFERENCES users(id) NOT NULL,
  created_by_id UUID REFERENCES users(id),
  reminder_enabled BOOLEAN DEFAULT false,
  reminder_before VARCHAR(50),
  
  -- Details
  description TEXT,
  
  -- Reference
  reference_doctype VARCHAR(100),
  reference_docname VARCHAR(255),
  contact_person_id UUID REFERENCES tallac_contacts(id),
  organization_id UUID REFERENCES tallac_organizations(id),
  
  -- Outcome
  outcome_notes TEXT,
  completed_on TIMESTAMP,
  outcome_status VARCHAR(50),
  rescheduled_activity_id UUID REFERENCES tallac_activities(id),
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Call Status
CREATE TABLE IF NOT EXISTS call_statuses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  status_name VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Telephony Lines
CREATE TABLE IF NOT EXISTS telephony_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  line_name VARCHAR(255) NOT NULL,
  phone_number VARCHAR(50),
  provider VARCHAR(100),
  api_key TEXT,
  api_secret TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tallac Call Logs
CREATE TABLE IF NOT EXISTS tallac_call_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) UNIQUE NOT NULL, -- TCALL-00001 format
  call_type VARCHAR(50) NOT NULL, -- Incoming, Outgoing, Manual Log
  call_status_id UUID REFERENCES call_statuses(id) NOT NULL,
  call_date DATE NOT NULL,
  call_time TIME NOT NULL,
  call_outcome VARCHAR(50),
  handled_by_id UUID REFERENCES users(id),
  
  -- Telephony
  telephony_line_id UUID REFERENCES telephony_lines(id),
  caller_number VARCHAR(50),
  receiver_number VARCHAR(50),
  call_duration INTEGER, -- in seconds
  
  -- Recording
  recording_available BOOLEAN DEFAULT false,
  recording_url VARCHAR(500),
  
  -- Reference
  reference_doctype VARCHAR(100),
  reference_docname VARCHAR(255),
  contact_person_id UUID REFERENCES tallac_contacts(id),
  organization_id UUID REFERENCES tallac_organizations(id),
  
  -- Notes
  call_summary TEXT,
  call_notes TEXT,
  internal_notes TEXT,
  
  -- Follow-up
  follow_up_required BOOLEAN DEFAULT false,
  follow_up_activity_id UUID REFERENCES tallac_activities(id),
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tallac Notes
CREATE TABLE IF NOT EXISTS tallac_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255),
  content TEXT NOT NULL,
  reference_doctype VARCHAR(100),
  reference_docname VARCHAR(255),
  created_by_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_leads_status ON tallac_leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON tallac_leads(assigned_to_id);
CREATE INDEX IF NOT EXISTS idx_leads_territory ON tallac_leads(territory_id);
CREATE INDEX IF NOT EXISTS idx_leads_company_name ON tallac_leads(company_name);
CREATE INDEX IF NOT EXISTS idx_activities_scheduled_date ON tallac_activities(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_activities_assigned_to ON tallac_activities(assigned_to_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_call_date ON tallac_call_logs(call_date);
CREATE INDEX IF NOT EXISTS idx_call_logs_reference ON tallac_call_logs(reference_doctype, reference_docname);

-- Insert default statuses
INSERT INTO activity_statuses (status_name) VALUES 
  ('Open'), ('In Progress'), ('Completed'), ('Cancelled'), ('Rescheduled')
ON CONFLICT (status_name) DO NOTHING;

INSERT INTO call_statuses (status_name) VALUES 
  ('Connected'), ('No Answer'), ('Busy'), ('Voicemail'), ('Failed'), ('Cancelled')
ON CONFLICT (status_name) DO NOTHING;

