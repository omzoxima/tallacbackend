// Migration script to add missing columns to tallac_contacts table
const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Starting migration...');
    
    // Add preferred_call_time column
    console.log('Adding preferred_call_time column...');
    await client.query(`
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
    `);
    console.log('✅ preferred_call_time column added/verified');
    
    // Add is_primary column
    console.log('Adding is_primary column...');
    await client.query(`
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
    `);
    console.log('✅ is_primary column added/verified');
    
    // Set first contact of each organization as primary if no primary exists
    console.log('Setting primary contacts...');
    const result = await client.query(`
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
    `);
    console.log(`✅ Set ${result.rowCount} contacts as primary`);
    
    console.log('🎉 Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration()
  .then(() => {
    console.log('Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });

