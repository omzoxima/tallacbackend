-- Migration: Add missing columns to tallac_contacts table
-- Date: 2025-12-04
-- Purpose: Fix contact creation errors

-- Add preferred_call_time column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tallac_contacts' 
        AND column_name = 'preferred_call_time'
    ) THEN
        ALTER TABLE tallac_contacts 
        ADD COLUMN preferred_call_time VARCHAR(100);
        
        RAISE NOTICE 'Added column: preferred_call_time';
    ELSE
        RAISE NOTICE 'Column preferred_call_time already exists';
    END IF;
END $$;

-- Add is_primary column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tallac_contacts' 
        AND column_name = 'is_primary'
    ) THEN
        ALTER TABLE tallac_contacts 
        ADD COLUMN is_primary BOOLEAN DEFAULT false;
        
        RAISE NOTICE 'Added column: is_primary';
    ELSE
        RAISE NOTICE 'Column is_primary already exists';
    END IF;
END $$;

-- Set first contact of each organization as primary if no primary exists
UPDATE tallac_contacts c1
SET is_primary = true
WHERE id IN (
    SELECT DISTINCT ON (organization_id) id
    FROM tallac_contacts
    WHERE organization_id IS NOT NULL
    ORDER BY organization_id, created_at ASC
)
AND NOT EXISTS (
    SELECT 1 FROM tallac_contacts c2 
    WHERE c2.organization_id = c1.organization_id 
    AND c2.is_primary = true
);

SELECT 'Migration completed successfully!' as status;

