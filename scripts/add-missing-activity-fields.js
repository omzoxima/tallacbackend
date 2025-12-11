import pool from '../config/database.js';

async function addMissingFields() {
  const client = await pool.connect();
  
  try {
    console.log('Adding missing fields to tallac_activities table...');
    
    // Add status_id if it doesn't exist (for foreign key to activity_statuses)
    try {
      await client.query(`
        ALTER TABLE tallac_activities 
        ADD COLUMN IF NOT EXISTS status_id UUID REFERENCES activity_statuses(id)
      `);
      console.log('✅ Added status_id column');
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.log('⚠️ status_id:', error.message);
      }
    }

    // Add reference_docname and reference_doctype for dynamic linking
    try {
      await client.query(`
        ALTER TABLE tallac_activities 
        ADD COLUMN IF NOT EXISTS reference_docname VARCHAR(255)
      `);
      console.log('✅ Added reference_docname column');
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.log('⚠️ reference_docname:', error.message);
      }
    }

    try {
      await client.query(`
        ALTER TABLE tallac_activities 
        ADD COLUMN IF NOT EXISTS reference_doctype VARCHAR(100)
      `);
      console.log('✅ Added reference_doctype column');
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.log('⚠️ reference_doctype:', error.message);
      }
    }

    // Add contact_person_id as alias for contact_id (for compatibility)
    try {
      await client.query(`
        ALTER TABLE tallac_activities 
        ADD COLUMN IF NOT EXISTS contact_person_id UUID REFERENCES contacts(id)
      `);
      console.log('✅ Added contact_person_id column');
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.log('⚠️ contact_person_id:', error.message);
      }
    }

    // Add completed_on field (used in Python API)
    try {
      await client.query(`
        ALTER TABLE tallac_activities 
        ADD COLUMN IF NOT EXISTS completed_on TIMESTAMP
      `);
      console.log('✅ Added completed_on column');
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.log('⚠️ completed_on:', error.message);
      }
    }

    // Add outcome_status field (used in Python API as alias for call_outcome)
    try {
      await client.query(`
        ALTER TABLE tallac_activities 
        ADD COLUMN IF NOT EXISTS outcome_status VARCHAR(50)
      `);
      console.log('✅ Added outcome_status column');
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.log('⚠️ outcome_status:', error.message);
      }
    }

    // Ensure activity_code exists (primary field)
    try {
      await client.query(`
        ALTER TABLE tallac_activities 
        ADD COLUMN IF NOT EXISTS activity_code VARCHAR(50) UNIQUE
      `);
      console.log('✅ Verified activity_code column exists');
      
      // If activity_code is null but name exists, copy name to activity_code
      await client.query(`
        UPDATE tallac_activities 
        SET activity_code = name 
        WHERE activity_code IS NULL AND name IS NOT NULL
      `);
      console.log('✅ Synced name to activity_code where needed');
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.log('⚠️ activity_code:', error.message);
      }
    }

    // Add name field (used in Python API, maps to activity_code)
    try {
      await client.query(`
        ALTER TABLE tallac_activities 
        ADD COLUMN IF NOT EXISTS name VARCHAR(50)
      `);
      console.log('✅ Added name column');
      
      // If name is null but activity_code exists, copy activity_code to name
      await client.query(`
        UPDATE tallac_activities 
        SET name = activity_code 
        WHERE name IS NULL AND activity_code IS NOT NULL
      `);
      console.log('✅ Synced activity_code to name where needed');
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.log('⚠️ name:', error.message);
      }
    }

    // Add title field (used in Python API, might be different from subject)
    try {
      await client.query(`
        ALTER TABLE tallac_activities 
        ADD COLUMN IF NOT EXISTS title VARCHAR(255)
      `);
      console.log('✅ Added title column');
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.log('⚠️ title:', error.message);
      }
    }

    // Ensure date_time exists (it should, but make sure)
    try {
      await client.query(`
        ALTER TABLE tallac_activities 
        ADD COLUMN IF NOT EXISTS date_time TIMESTAMP
      `);
      console.log('✅ Verified date_time column exists');
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.log('⚠️ date_time:', error.message);
      }
    }

    // Create index on status_id for performance
    try {
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_tallac_activities_status_id 
        ON tallac_activities(status_id)
      `);
      console.log('✅ Created index on status_id');
    } catch (error) {
      console.log('⚠️ Index creation:', error.message);
    }

    // Create index on reference fields for performance
    try {
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_tallac_activities_reference 
        ON tallac_activities(reference_doctype, reference_docname)
      `);
      console.log('✅ Created index on reference fields');
    } catch (error) {
      console.log('⚠️ Index creation:', error.message);
    }

    // Create a function to sync activity_code and name
    try {
      await client.query(`
        CREATE OR REPLACE FUNCTION sync_activity_codes()
        RETURNS void AS $$
        BEGIN
          -- If activity_code is null but name exists, copy name to activity_code
          UPDATE tallac_activities 
          SET activity_code = name 
          WHERE (activity_code IS NULL OR activity_code = '') AND name IS NOT NULL;
          
          -- If name is null but activity_code exists, copy activity_code to name
          UPDATE tallac_activities 
          SET name = activity_code 
          WHERE (name IS NULL OR name = '') AND activity_code IS NOT NULL;
        END;
        $$ LANGUAGE plpgsql;
      `);
      await client.query('SELECT sync_activity_codes()');
      console.log('✅ Synced activity_code and name fields');
    } catch (error) {
      console.log('⚠️ Sync function:', error.message);
    }

    console.log('\n✅ All missing fields added successfully!');
    
  } catch (error) {
    console.error('❌ Error adding fields:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  addMissingFields()
    .then(() => {
      console.log('Migration completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

export default addMissingFields;

