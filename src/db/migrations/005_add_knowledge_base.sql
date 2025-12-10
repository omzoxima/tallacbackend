-- Migration: Add Knowledge Base tables for file uploads and role-based access

-- Create knowledge_base_files table
CREATE TABLE IF NOT EXISTS knowledge_base_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_name VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_size BIGINT NOT NULL,
  file_type VARCHAR(100),
  mime_type VARCHAR(100),
  description TEXT,
  uploaded_by_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create knowledge_base_file_roles table (many-to-many relationship)
-- This determines which roles can access which files
CREATE TABLE IF NOT EXISTS knowledge_base_file_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_id UUID REFERENCES knowledge_base_files(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(file_id, role)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_kb_files_uploaded_by ON knowledge_base_files(uploaded_by_id);
CREATE INDEX IF NOT EXISTS idx_kb_files_created_at ON knowledge_base_files(created_at);
CREATE INDEX IF NOT EXISTS idx_kb_files_updated_at ON knowledge_base_files(updated_at);
CREATE INDEX IF NOT EXISTS idx_kb_file_roles_file_id ON knowledge_base_file_roles(file_id);
CREATE INDEX IF NOT EXISTS idx_kb_file_roles_role ON knowledge_base_file_roles(role);

-- Create trigger to update updated_at timestamp automatically
CREATE OR REPLACE FUNCTION update_knowledge_base_files_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists and create new one
DROP TRIGGER IF EXISTS trigger_update_kb_files_updated_at ON knowledge_base_files;
CREATE TRIGGER trigger_update_kb_files_updated_at
  BEFORE UPDATE ON knowledge_base_files
  FOR EACH ROW
  EXECUTE FUNCTION update_knowledge_base_files_updated_at();

