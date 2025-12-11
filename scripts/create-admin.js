// Script to create admin user
// Usage: node scripts/create-admin.js

import bcrypt from 'bcryptjs';
import pool from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

const createAdmin = async () => {
  try {
    const email = process.argv[2] || 'admin@tallac.com';
    const password = process.argv[3] || 'admin123';
    const firstName = process.argv[4] || 'Admin';
    const lastName = process.argv[5] || 'User';

    console.log('Creating admin user...');

    // Check if user exists
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      console.log('User already exists!');
      process.exit(1);
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 10);
    const full_name = `${firstName} ${lastName}`.trim();

    // Create user
    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, full_name, enabled, user_type)
       VALUES ($1, $2, $3, $4, $5, true, 'System User')
       RETURNING id, email, first_name, last_name, full_name`,
      [email.toLowerCase(), password_hash, firstName, lastName, full_name]
    );

    const user = userResult.rows[0];
    console.log('User created:', user);

    // Create tallac user profile
    const tallacUserResult = await pool.query(
      `INSERT INTO tallac_users (user_id, tallac_role, status)
       VALUES ($1, 'Corporate Admin', 'Active')
       RETURNING id`,
      [user.id]
    );

    console.log('Tallac user profile created:', tallacUserResult.rows[0]);
    console.log('\n✅ Admin user created successfully!');
    console.log(`Email: ${email}`);
    console.log(`Password: ${password}`);
    console.log('\nYou can now login with these credentials.');

    process.exit(0);
  } catch (error) {
    console.error('Error creating admin:', error);
    process.exit(1);
  }
};

createAdmin();

