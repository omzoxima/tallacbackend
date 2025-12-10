import pool from '../config/database.js';

async function columnExists(tableName, columnName) {
  const res = await pool.query(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = $1 AND column_name = $2
    );
  `, [tableName, columnName]);
  return res.rows[0].exists;
}

async function addColumn(tableName, columnName, columnDefinition) {
  if (!(await columnExists(tableName, columnName))) {
    console.log(`Adding ${columnName} column to ${tableName}...`);
    await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
    console.log(`✓ ${columnName} column added to ${tableName}`);
  } else {
    console.log(`✓ ${columnName} column already exists in ${tableName}`);
  }
}

(async () => {
  try {
    console.log('Connected to PostgreSQL database');

    // Add primary_admin_id to tallac_partners
    await addColumn('tallac_partners', 'primary_admin_id', 'UUID REFERENCES tallac_users(id)');

    console.log('\nAll columns checked/added successfully!');
    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();

