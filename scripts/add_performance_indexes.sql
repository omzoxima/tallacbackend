-- Performance Optimization: Add Missing Database Indexes
-- Run this script to improve query performance

-- Leads table indexes
CREATE INDEX IF NOT EXISTS idx_leads_updated_at ON tallac_leads(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON tallac_leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_owner_status ON tallac_leads(lead_owner_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_territory_status ON tallac_leads(territory_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_primary_contact ON tallac_leads(primary_contact_id);
CREATE INDEX IF NOT EXISTS idx_leads_callback_date ON tallac_leads(callback_date) WHERE callback_date IS NOT NULL;

-- Activities table indexes
CREATE INDEX IF NOT EXISTS idx_activities_status_date ON tallac_activities(status_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_activities_assigned_date ON tallac_activities(assigned_to_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_activities_reference ON tallac_activities(reference_doctype, reference_docname);
CREATE INDEX IF NOT EXISTS idx_activities_created_at ON tallac_activities(created_at DESC);

-- Lead contacts table indexes
CREATE INDEX IF NOT EXISTS idx_lead_contacts_lead_id ON tallac_lead_contacts(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_contacts_contact_id ON tallac_lead_contacts(contact_id);
CREATE INDEX IF NOT EXISTS idx_lead_contacts_sequence ON tallac_lead_contacts(lead_id, sequence);

-- Contacts table indexes
CREATE INDEX IF NOT EXISTS idx_contacts_full_name ON tallac_contacts(full_name);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON tallac_contacts(email) WHERE email IS NOT NULL;

-- Partners table indexes
CREATE INDEX IF NOT EXISTS idx_partners_created_at ON tallac_partners(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_partners_updated_at ON tallac_partners(updated_at DESC);

-- Users table indexes
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active) WHERE is_active = true;

-- Territories table indexes
CREATE INDEX IF NOT EXISTS idx_territories_status ON tallac_territories(status);
CREATE INDEX IF NOT EXISTS idx_territories_created_at ON tallac_territories(created_at DESC);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_leads_filter_combo ON tallac_leads(territory_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_queue ON tallac_activities(scheduled_date, status_id) 
  WHERE scheduled_date <= CURRENT_DATE + INTERVAL '7 days';

-- Analyze tables to update statistics
ANALYZE tallac_leads;
ANALYZE tallac_activities;
ANALYZE tallac_contacts;
ANALYZE tallac_lead_contacts;
ANALYZE tallac_partners;
ANALYZE users;
ANALYZE tallac_territories;

