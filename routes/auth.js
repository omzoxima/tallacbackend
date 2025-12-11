import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log('Login attempt:', { email: email?.toLowerCase(), hasPassword: !!password });

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }

    // Get user with tallac profile - handle both camelCase and snake_case column names
    // Actual database has: active, is_active (NOT enabled)
    const result = await pool.query(
      `SELECT u.*, 
              tu.tallac_role, 
              tu.status as tallac_status, 
              tu.reports_to, 
              tu.id as tallac_user_id,
              COALESCE(u."passwordHash", u.password_hash) as password_hash,
              COALESCE(u."firstName", u.first_name) as first_name,
              COALESCE(u."lastName", u.last_name) as last_name,
              COALESCE(u."is_active", u.active, true) as is_enabled
       FROM users u
       LEFT JOIN tallac_users tu ON u.id = tu.user_id
       WHERE LOWER(u.email) = $1`,
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      console.log('User not found:', email.toLowerCase());
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const user = result.rows[0];

    // Check if account is enabled - use actual column names from database
    // Database has: active, is_active (NOT enabled)
    const isEnabled = (user.is_enabled !== false && user.is_enabled !== 0 && user.is_enabled !== null) ||
                      (user.active !== false && user.active !== 0 && user.active !== null) ||
                      (user.is_active !== false && user.is_active !== 0 && user.is_active !== null);
    
    if (!isEnabled) {
      console.log('Account disabled for:', email);
      return res.status(401).json({ success: false, message: 'Account is disabled' });
    }

    // Verify password - check both passwordHash and password_hash
    const storedPassword = user.password_hash || user.passwordHash;
    if (!storedPassword) {
      console.error('No password hash found for user:', email);
      return res.status(500).json({ success: false, message: 'Account configuration error' });
    }

    const isValidPassword = await bcrypt.compare(password, storedPassword);
    if (!isValidPassword) {
      console.log('Invalid password for:', email);
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    console.log('Login successful for:', email);

    // Get user's assigned territories
    const territoriesResult = await pool.query(
      `SELECT territory_id FROM assigned_territories WHERE tallac_user_id = $1`,
      [user.tallac_user_id]
    );

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        full_name: user.full_name,
        mobile_no: user.mobile_no,
        tallac_role: user.tallac_role,
        status: user.tallac_status,
        reports_to: user.reports_to,
        territories: territoriesResult.rows.map(t => t.territory_id)
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Login failed', error: error.message });
  }
});

// Get current user
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get full user profile with territories - handle both camelCase and snake_case
    // Use actual database columns: active, is_active (NOT enabled)
    const userResult = await pool.query(
      `SELECT u.*, 
              tu.tallac_role, 
              tu.status as tallac_status, 
              tu.reports_to, 
              tu.id as tallac_user_id,
              COALESCE(u."firstName", u.first_name) as first_name,
              COALESCE(u."lastName", u.last_name) as last_name,
              u.full_name,
              COALESCE(u.mobile_no, u.phone) as mobile_no,
              COALESCE(u."is_active", u.active, true) as is_enabled
       FROM users u
       LEFT JOIN tallac_users tu ON u.id = tu.user_id
       WHERE u.id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = userResult.rows[0];

    // Get assigned territories
    const territoriesResult = await pool.query(
      `SELECT t.id, t.territory_code, t.territory_name 
       FROM assigned_territories at
       JOIN tallac_territories t ON at.territory_id = t.id
       WHERE at.tallac_user_id = $1`,
      [user.tallac_user_id]
    );

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        full_name: user.full_name,
        mobile_no: user.mobile_no,
        tallac_role: user.tallac_role,
        status: user.tallac_status,
        reports_to: user.reports_to,
        territories: territoriesResult.rows
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, message: 'Failed to get user', error: error.message });
  }
});

// Register (for admin use)
router.post('/register', authenticateToken, async (req, res) => {
  try {
    // Only allow admins to register users
    if (!['Corporate Admin', 'System Manager', 'Administrator'].includes(req.user.tallac_role)) {
      return res.status(403).json({ success: false, message: 'Only admins can register users' });
    }

    const { email, password, first_name, last_name, mobile_no, tallac_role, status, reports_to, territories } = req.body;

    if (!email || !password || !first_name || !tallac_role) {
      return res.status(400).json({ success: false, message: 'Email, password, first_name, and tallac_role are required' });
    }

    // Check if user already exists
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 10);
    const full_name = `${first_name} ${last_name || ''}`.trim();

    // Create user
    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, "passwordHash", first_name, "firstName", last_name, "lastName", full_name, mobile_no, phone, "is_active", active, user_type)
       VALUES ($1, $2, $2, $3, $3, $4, $4, $5, $6, $6, true, true, 'System User')
       RETURNING id, email, first_name, last_name, full_name`,
      [email.toLowerCase(), password_hash, first_name, last_name, full_name, mobile_no]
    );

    const user = userResult.rows[0];

    // Create tallac user profile
    const tallacUserResult = await pool.query(
      `INSERT INTO tallac_users (user_id, tallac_role, status, reports_to)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [user.id, tallac_role, status || 'Active', reports_to || null]
    );

    const tallacUserId = tallacUserResult.rows[0].id;

    // Assign territories if provided
    if (territories && Array.isArray(territories) && territories.length > 0) {
      for (const territory of territories) {
        // Handle both UUID strings and objects with id/territory_id
        const territoryId = typeof territory === 'string' ? territory : (territory.id || territory.territory_id || territory);
        
        if (territoryId) {
          try {
        await pool.query(
              `INSERT INTO assigned_territories (tallac_user_id, territory_id, is_primary)
               VALUES ($1, $2, $3)
               ON CONFLICT (tallac_user_id, territory_id) DO NOTHING`,
              [tallacUserId, territoryId, false]
        );
          } catch (err) {
            console.error(`Error assigning territory ${territoryId} to user:`, err.message);
          }
        }
      }
    }

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        full_name: user.full_name,
        tallac_role
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ success: false, message: 'Failed to create user', error: error.message });
  }
});

// Forgot Password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    // Check if user exists
    const result = await pool.query(
      `SELECT u.id, u.email, u."firstName" as first_name, u."lastName" as last_name
       FROM users u
       WHERE LOWER(u.email) = $1`,
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      // Don't reveal if email exists or not (security best practice)
      return res.json({
        success: true,
        message: 'If an account exists with this email, a password reset link has been sent.'
      });
    }

    const user = result.rows[0];

    // TODO: Generate reset token and send email
    // For now, just return success
    // In production, you would:
    // 1. Generate a secure reset token
    // 2. Store it in database with expiration
    // 3. Send email with reset link
    // 4. User clicks link, enters new password
    // 5. Verify token and update password

    console.log(`Password reset requested for: ${email}`);

    res.json({
      success: true,
      message: 'If an account exists with this email, a password reset link has been sent.'
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ success: false, message: 'Failed to process request', error: error.message });
  }
});

export default router;

