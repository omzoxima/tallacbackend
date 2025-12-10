// Script to create test users for each role
// Usage: node scripts/create-test-users.js

import bcrypt from 'bcryptjs';
import pool from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

const roles = [
  { role: 'Corporate Admin', email: 'corporate.admin@tallac.com', firstName: 'Corporate', lastName: 'Admin', password: 'admin123' },
  { role: 'Territory Admin', email: 'territory.admin@tallac.com', firstName: 'Territory', lastName: 'Admin', password: 'admin123' },
  { role: 'Sales User', email: 'sales.user@tallac.com', firstName: 'Sales', lastName: 'User', password: 'admin123' },
  { role: 'Territory Manager', email: 'territory.manager@tallac.com', firstName: 'Territory', lastName: 'Manager', password: 'admin123' },
  { role: 'Business Coach', email: 'business.coach@tallac.com', firstName: 'Business', lastName: 'Coach', password: 'admin123' },
];

const createTestUsers = async () => {
  try {
    // Test connection first
    await pool.query('SELECT 1');
    console.log('✅ Database connection successful\n');
    console.log('Creating test users for each role...\n');

    for (const roleData of roles) {
      try {
        // Check if user exists
        const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [roleData.email]);
        if (existingUser.rows.length > 0) {
          console.log(`⚠️  User ${roleData.email} already exists, skipping...`);
          continue;
        }

        // Hash password
        const password_hash = await bcrypt.hash(roleData.password, 10);
        const full_name = `${roleData.firstName} ${roleData.lastName}`.trim();

        // Database uses camelCase columns (firstName, lastName, passwordHash) with NOT NULL constraints
        // Use camelCase column names - need to quote them in PostgreSQL
        let insertColumns = ['email', '"passwordHash"', '"firstName"', '"lastName"', 'full_name'];
        let insertValues = [roleData.email.toLowerCase(), password_hash, roleData.firstName, roleData.lastName, full_name];
        let placeholders = ['$1', '$2', '$3', '$4', '$5'];

        // Create user
        const userResult = await pool.query(
          `INSERT INTO users (${insertColumns.join(', ')})
           VALUES (${placeholders.join(', ')})
           RETURNING id, email, "firstName" as first_name, "lastName" as last_name, full_name`,
          insertValues
        );

        const user = userResult.rows[0];

        // Create tallac user profile
        const tallacUserResult = await pool.query(
          `INSERT INTO tallac_users (user_id, tallac_role, status)
           VALUES ($1, $2, 'Active')
           RETURNING id`,
          [user.id, roleData.role]
        );

        console.log(`✅ Created ${roleData.role}:`);
        console.log(`   Email: ${roleData.email}`);
        console.log(`   Password: ${roleData.password}`);
        console.log(`   User ID: ${user.id}`);
        console.log(`   Tallac User ID: ${tallacUserResult.rows[0].id}\n`);
      } catch (error) {
        console.error(`❌ Error creating user ${roleData.email}:`, error.message);
        if (error.detail) {
          console.error(`   Detail: ${error.detail}`);
        }
      }
    }

    console.log('\n✅ Test users creation completed!');
    console.log('\nYou can now login with any of these credentials:');
    roles.forEach(roleData => {
      console.log(`   ${roleData.role}: ${roleData.email} / ${roleData.password}`);
    });

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating test users:', error.message);
    if (error.code) {
      console.error(`   Error code: ${error.code}`);
    }
    await pool.end();
    process.exit(1);
  }
};

createTestUsers();

