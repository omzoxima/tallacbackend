import { pool } from '../src/config/database';
import fs from 'fs';
import path from 'path';

interface TableUsage {
  tableName: string;
  usedInRoutes: string[];
  usedInMigrations: boolean;
  hasData: boolean;
}

async function analyzeTables() {
  try {
    console.log('🔍 Analyzing database tables...\n');

    // Get all tables from database
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    const allTables = tablesResult.rows.map(row => row.table_name);
    console.log(`Found ${allTables.length} tables in database:\n`);

    // Read all route files
    const routesDir = path.join(__dirname, '../src/routes');
    const routeFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.ts'));
    
    const tableUsage: Record<string, TableUsage> = {};

    // Initialize table usage
    for (const table of allTables) {
      tableUsage[table] = {
        tableName: table,
        usedInRoutes: [],
        usedInMigrations: true,
        hasData: false,
      };
    }

    // Check usage in route files
    for (const file of routeFiles) {
      const filePath = path.join(routesDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      
      for (const table of allTables) {
        // Check if table is mentioned in the file (case-insensitive)
        const regex = new RegExp(`\\b${table}\\b`, 'gi');
        if (regex.test(content)) {
          if (!tableUsage[table].usedInRoutes.includes(file)) {
            tableUsage[table].usedInRoutes.push(file);
          }
        }
      }
    }

    // Check if tables have data
    for (const table of allTables) {
      try {
        const countResult = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
        tableUsage[table].hasData = parseInt(countResult.rows[0].count) > 0;
      } catch (error) {
        // Table might not exist or might have issues
        console.warn(`Warning: Could not check data for table ${table}`);
      }
    }

    // Categorize tables
    const usedTables: TableUsage[] = [];
    const unusedTables: TableUsage[] = [];

    for (const table of allTables) {
      if (tableUsage[table].usedInRoutes.length > 0) {
        usedTables.push(tableUsage[table]);
      } else {
        unusedTables.push(tableUsage[table]);
      }
    }

    // Print results
    console.log('='.repeat(80));
    console.log('📊 TABLE USAGE ANALYSIS');
    console.log('='.repeat(80));
    console.log(`\n✅ USED TABLES (${usedTables.length}):\n`);
    usedTables.forEach(table => {
      console.log(`  ${table.tableName}`);
      console.log(`    Used in: ${table.usedInRoutes.join(', ') || 'None'}`);
      console.log(`    Has data: ${table.hasData ? 'Yes' : 'No'}`);
      console.log('');
    });

    console.log('\n' + '='.repeat(80));
    console.log(`❌ UNUSED TABLES (${unusedTables.length}):\n`);
    unusedTables.forEach(table => {
      console.log(`  ${table.tableName}`);
      console.log(`    Has data: ${table.hasData ? 'Yes' : 'No'}`);
      console.log('');
    });

    // Summary
    console.log('='.repeat(80));
    console.log('📈 SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total tables: ${allTables.length}`);
    console.log(`Used tables: ${usedTables.length}`);
    console.log(`Unused tables: ${unusedTables.length}`);
    console.log(`Tables with data: ${allTables.filter(t => tableUsage[t].hasData).length}`);
    console.log(`Tables without data: ${allTables.filter(t => !tableUsage[t].hasData).length}`);

    await pool.end();
  } catch (error) {
    console.error('Error analyzing tables:', error);
    process.exit(1);
  }
}

analyzeTables();

