import pool from '../config/database.js';

async function checkAndAddActivityCode() {
  const client = await pool.connect();
  
  try {
    console.log('Checking for activity_code column...');
    
    // Check if activity_code column exists
    const checkResult = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'tallac_activities' 
      AND column_name IN ('activity_code', 'name')
    `);
    
    const existingColumns = checkResult.rows.map(r => r.column_name);
    console.log('Existing columns:', existingColumns);
    
    // Add activity_code if it doesn't exist
    if (!existingColumns.includes('activity_code')) {
      console.log('Adding activity_code column...');
      await client.query(`
        ALTER TABLE tallac_activities 
        ADD COLUMN activity_code VARCHAR(50)
      `);
      
      // If name exists, copy values from name to activity_code
      if (existingColumns.includes('name')) {
        console.log('Copying name values to activity_code...');
        await client.query(`
          UPDATE tallac_activities 
          SET activity_code = name 
          WHERE activity_code IS NULL AND name IS NOT NULL
        `);
      }
      
      // Add unique constraint if there are no duplicates
      try {
        await client.query(`
          ALTER TABLE tallac_activities 
          ADD CONSTRAINT tallac_activities_activity_code_unique UNIQUE (activity_code)
        `);
        console.log('✅ Added unique constraint on activity_code');
      } catch (error) {
        console.log('⚠️ Could not add unique constraint (may have duplicates):', error.message);
      }
      
      console.log('✅ Added activity_code column');
    } else {
      console.log('✅ activity_code column already exists');
    }
    
    // Add name if it doesn't exist
    if (!existingColumns.includes('name')) {
      console.log('Adding name column...');
      await client.query(`
        ALTER TABLE tallac_activities 
        ADD COLUMN name VARCHAR(50)
      `);
      
      // Copy values from activity_code to name
      await client.query(`
        UPDATE tallac_activities 
        SET name = activity_code 
        WHERE name IS NULL AND activity_code IS NOT NULL
      `);
      
      console.log('✅ Added name column');
    } else {
      console.log('✅ name column already exists');
    }
    
    console.log('\n✅ All columns verified and synced!');
    
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  checkAndAddActivityCode()
    .then(() => {
      console.log('Migration completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

export default checkAndAddActivityCode;

