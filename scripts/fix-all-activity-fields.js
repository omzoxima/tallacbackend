import pool from '../config/database.js';

async function fixAllActivityFields() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Fixing ALL activity table fields in ONE go...\n');
    
    // Get existing columns
    const columnsResult = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'tallac_activities'
      ORDER BY column_name
    `);
    
    const existingColumns = new Set(columnsResult.rows.map(r => r.column_name));
    console.log(`Found ${existingColumns.size} existing columns\n`);
    
    // ALL columns used in API that might be missing
    const requiredColumns = [
      // Activity identification
      { name: 'activity_code', type: 'VARCHAR(50)', unique: true, fk: null },
      { name: 'name', type: 'VARCHAR(50)', unique: false, fk: null },
      
      // Subject/Title
      { name: 'subject', type: 'VARCHAR(255)', unique: false, fk: null },
      { name: 'title', type: 'VARCHAR(255)', unique: false, fk: null },
      
      // Status
      { name: 'status_id', type: 'UUID', unique: false, fk: 'activity_statuses(id)' },
      { name: 'status', type: 'VARCHAR(50)', unique: false, fk: null },
      
      // Reference fields
      { name: 'reference_docname', type: 'VARCHAR(255)', unique: false, fk: null },
      { name: 'reference_doctype', type: 'VARCHAR(100)', unique: false, fk: null },
      
      // Organization/Company
      { name: 'organization_id', type: 'UUID', unique: false, fk: 'tallac_organizations(id)' },
      
      // Contact
      { name: 'contact_person_id', type: 'UUID', unique: false, fk: 'contacts(id)' },
      
      // Outcome
      { name: 'outcome_status', type: 'VARCHAR(50)', unique: false, fk: null },
      
      // Date/Time fields
      { name: 'completed_on', type: 'TIMESTAMP', unique: false, fk: null },
      { name: 'date_time', type: 'TIMESTAMP', unique: false, fk: null },
      { name: 'end_time', type: 'TIMESTAMP', unique: false, fk: null },
    ];
    
    const columnsToAdd = [];
    
    // Add all missing columns
    for (const col of requiredColumns) {
      if (!existingColumns.has(col.name)) {
        columnsToAdd.push(col);
        try {
          // Add column first
          let sql = `ALTER TABLE tallac_activities ADD COLUMN ${col.name} ${col.type}`;
          await client.query(sql);
          console.log(`✅ Added column: ${col.name}`);
          
          // Add foreign key constraint if needed
          if (col.fk) {
            try {
              await client.query(`
                ALTER TABLE tallac_activities 
                ADD CONSTRAINT tallac_activities_${col.name}_fkey 
                FOREIGN KEY (${col.name}) REFERENCES ${col.fk}
              `);
              console.log(`   ✅ Added FK constraint on ${col.name}`);
            } catch (e) {
              console.log(`   ⚠️  Could not add FK constraint on ${col.name}: ${e.message}`);
            }
          }
          
          // Add unique constraint if needed
          if (col.unique) {
            try {
              await client.query(`
                ALTER TABLE tallac_activities 
                ADD CONSTRAINT tallac_activities_${col.name}_unique UNIQUE (${col.name})
              `);
              console.log(`   ✅ Added unique constraint on ${col.name}`);
            } catch (e) {
              console.log(`   ⚠️  Could not add unique constraint on ${col.name} (may have duplicates)`);
            }
          }
        } catch (error) {
          console.log(`   ❌ Error adding ${col.name}: ${error.message}`);
        }
      } else {
        console.log(`✓ Column already exists: ${col.name}`);
      }
    }
    
    // Sync data between related columns
    console.log('\n🔄 Syncing data between columns...');
    
    // Sync activity_code and name
    if (existingColumns.has('name') || columnsToAdd.find(c => c.name === 'name')) {
      if (existingColumns.has('activity_code') || columnsToAdd.find(c => c.name === 'activity_code')) {
        try {
          await client.query(`
            UPDATE tallac_activities 
            SET activity_code = name 
            WHERE (activity_code IS NULL OR activity_code = '') AND name IS NOT NULL
          `);
          await client.query(`
            UPDATE tallac_activities 
            SET name = activity_code 
            WHERE (name IS NULL OR name = '') AND activity_code IS NOT NULL
          `);
          console.log('✅ Synced activity_code ↔ name');
        } catch (e) {
          console.log('   ⚠️  Could not sync activity_code/name:', e.message);
        }
      }
    }
    
    // Sync subject and title
    if (existingColumns.has('subject') || columnsToAdd.find(c => c.name === 'subject')) {
      if (existingColumns.has('title') || columnsToAdd.find(c => c.name === 'title')) {
        try {
          await client.query(`
            UPDATE tallac_activities 
            SET title = subject 
            WHERE (title IS NULL OR title = '') AND subject IS NOT NULL
          `);
          await client.query(`
            UPDATE tallac_activities 
            SET subject = title 
            WHERE (subject IS NULL OR subject = '') AND title IS NOT NULL
          `);
          console.log('✅ Synced subject ↔ title');
        } catch (e) {
          console.log('   ⚠️  Could not sync subject/title:', e.message);
        }
      }
    }
    
    // Sync call_outcome and outcome_status
    if (existingColumns.has('call_outcome') || columnsToAdd.find(c => c.name === 'call_outcome')) {
      if (existingColumns.has('outcome_status') || columnsToAdd.find(c => c.name === 'outcome_status')) {
        try {
          await client.query(`
            UPDATE tallac_activities 
            SET outcome_status = call_outcome 
            WHERE (outcome_status IS NULL OR outcome_status = '') AND call_outcome IS NOT NULL
          `);
          await client.query(`
            UPDATE tallac_activities 
            SET call_outcome = outcome_status 
            WHERE (call_outcome IS NULL OR call_outcome = '') AND outcome_status IS NOT NULL
          `);
          console.log('✅ Synced call_outcome ↔ outcome_status');
        } catch (e) {
          console.log('   ⚠️  Could not sync call_outcome/outcome_status:', e.message);
        }
      }
    }
    
    // Sync date fields
    if (existingColumns.has('date_time') || columnsToAdd.find(c => c.name === 'date_time')) {
      if (existingColumns.has('completed_on') || columnsToAdd.find(c => c.name === 'completed_on')) {
        try {
          await client.query(`
            UPDATE tallac_activities 
            SET completed_on = date_time 
            WHERE completed_on IS NULL AND date_time IS NOT NULL
          `);
          console.log('✅ Synced date_time → completed_on');
        } catch (e) {
          console.log('   ⚠️  Could not sync date_time/completed_on:', e.message);
        }
      }
    }
    
    if (existingColumns.has('end_time') || columnsToAdd.find(c => c.name === 'end_time')) {
      if (existingColumns.has('completed_on') || columnsToAdd.find(c => c.name === 'completed_on')) {
        try {
          await client.query(`
            UPDATE tallac_activities 
            SET completed_on = end_time 
            WHERE completed_on IS NULL AND end_time IS NOT NULL
          `);
          console.log('✅ Synced end_time → completed_on');
        } catch (e) {
          console.log('   ⚠️  Could not sync end_time/completed_on:', e.message);
        }
      }
    }
    
    // Sync contact fields
    if (existingColumns.has('contact_id') || columnsToAdd.find(c => c.name === 'contact_id')) {
      if (existingColumns.has('contact_person_id') || columnsToAdd.find(c => c.name === 'contact_person_id')) {
        try {
          await client.query(`
            UPDATE tallac_activities 
            SET contact_person_id = contact_id 
            WHERE contact_person_id IS NULL AND contact_id IS NOT NULL
          `);
          console.log('✅ Synced contact_id → contact_person_id');
        } catch (e) {
          console.log('   ⚠️  Could not sync contact fields:', e.message);
        }
      }
    }
    
    // Sync organization/company fields
    if (existingColumns.has('company_id') || columnsToAdd.find(c => c.name === 'company_id')) {
      if (existingColumns.has('organization_id') || columnsToAdd.find(c => c.name === 'organization_id')) {
        try {
          await client.query(`
            UPDATE tallac_activities 
            SET organization_id = company_id 
            WHERE organization_id IS NULL AND company_id IS NOT NULL
          `);
          console.log('✅ Synced company_id → organization_id');
        } catch (e) {
          console.log('   ⚠️  Could not sync company/organization fields:', e.message);
        }
      }
    }
    
    // Sync prospect_id to reference_docname
    if (existingColumns.has('prospect_id') || columnsToAdd.find(c => c.name === 'prospect_id')) {
      if (existingColumns.has('reference_docname') || columnsToAdd.find(c => c.name === 'reference_docname')) {
        try {
          await client.query(`
            UPDATE tallac_activities 
            SET reference_docname = prospect_id::text 
            WHERE (reference_docname IS NULL OR reference_docname = '') AND prospect_id IS NOT NULL
          `);
          await client.query(`
            UPDATE tallac_activities 
            SET reference_doctype = 'Prospect' 
            WHERE reference_doctype IS NULL AND reference_docname IS NOT NULL
          `);
          console.log('✅ Synced prospect_id → reference_docname');
        } catch (e) {
          console.log('   ⚠️  Could not sync prospect/reference fields:', e.message);
        }
      }
    }
    
    // Create indexes for performance
    console.log('\n📊 Creating indexes...');
    const indexes = [
      { name: 'idx_tallac_activities_status_id', sql: 'CREATE INDEX IF NOT EXISTS idx_tallac_activities_status_id ON tallac_activities(status_id)' },
      { name: 'idx_tallac_activities_reference', sql: 'CREATE INDEX IF NOT EXISTS idx_tallac_activities_reference ON tallac_activities(reference_doctype, reference_docname)' },
      { name: 'idx_tallac_activities_name', sql: 'CREATE INDEX IF NOT EXISTS idx_tallac_activities_name ON tallac_activities(name)' },
      { name: 'idx_tallac_activities_activity_code', sql: 'CREATE INDEX IF NOT EXISTS idx_tallac_activities_activity_code ON tallac_activities(activity_code)' },
      { name: 'idx_tallac_activities_organization_id', sql: 'CREATE INDEX IF NOT EXISTS idx_tallac_activities_organization_id ON tallac_activities(organization_id)' },
      { name: 'idx_tallac_activities_contact_person_id', sql: 'CREATE INDEX IF NOT EXISTS idx_tallac_activities_contact_person_id ON tallac_activities(contact_person_id)' },
      { name: 'idx_tallac_activities_completed_on', sql: 'CREATE INDEX IF NOT EXISTS idx_tallac_activities_completed_on ON tallac_activities(completed_on)' },
    ];
    
    for (const idx of indexes) {
      try {
        await client.query(idx.sql);
        console.log(`✅ Created index: ${idx.name}`);
      } catch (e) {
        console.log(`   ⚠️  Index ${idx.name}: ${e.message}`);
      }
    }
    
    console.log('\n✅ ALL fields fixed successfully!');
    console.log(`\n📋 Summary:`);
    console.log(`   - Added ${columnsToAdd.length} new columns`);
    console.log(`   - Synced data between related columns`);
    console.log(`   - Created indexes for performance`);
    
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  fixAllActivityFields()
    .then(() => {
      console.log('\n🎉 Migration completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Migration failed:', error);
      process.exit(1);
    });
}

export default fixAllActivityFields;
