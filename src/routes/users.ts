import express from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../config/database';
import { authenticateToken, requireRole, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Get all users (Team management)
router.get('/', authenticateToken, requireRole('Corporate Admin', 'Territory Admin', 'Territory Manager'), async (req: AuthRequest, res) => {
  try {
    const { search, role, status, limit = 100, offset = 0 } = req.query;

    let query = `
      SELECT 
        u.id, u.email, u.first_name, u.last_name, u.full_name, u.role, u.is_active,
        u.created_at, u.updated_at, u.reports_to_id,
        m.full_name as reports_to_name, m.email as reports_to_email
      FROM users u
      LEFT JOIN users m ON u.reports_to_id = m.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramCount = 1;

    if (search) {
      query += ` AND (u.email ILIKE $${paramCount} OR u.full_name ILIKE $${paramCount} OR u.first_name ILIKE $${paramCount} OR u.last_name ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }

    if (role && role !== 'all') {
      query += ` AND u.role = $${paramCount}`;
      params.push(role);
      paramCount++;
    }

    if (status !== undefined) {
      if (status === 'active') {
        query += ` AND u.is_active = true`;
      } else if (status === 'inactive') {
        query += ` AND u.is_active = false`;
      }
    }

    query += ` ORDER BY u.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user by ID
router.get('/:id', authenticateToken, requireRole('Corporate Admin', 'Territory Admin', 'Territory Manager'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT 
        u.id, u.email, u.first_name, u.last_name, u.full_name, u.role, u.is_active,
        u.created_at, u.updated_at, u.reports_to_id,
        m.full_name as reports_to_name, m.email as reports_to_email
      FROM users u
      LEFT JOIN users m ON u.reports_to_id = m.id
      WHERE u.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create user (Corporate Admin, Territory Admin only)
router.post('/', authenticateToken, requireRole('Corporate Admin', 'Territory Admin'), async (req: AuthRequest, res) => {
  try {
    const {
      email,
      first_name,
      last_name,
      full_name,
      role,
      is_active,
      reports_to_id,
      password
    } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if user exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Default password is 12345, require password change on first login
    const defaultPassword = password || '12345';
    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    const computedFullName = full_name || (first_name && last_name ? `${first_name} ${last_name}` : first_name || last_name || email);

    const result = await pool.query(
      `INSERT INTO users (
        email, first_name, last_name, full_name, role, is_active, password_hash,
        password_change_required, reports_to_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, email, first_name, last_name, full_name, role, is_active, created_at`,
      [
        email,
        first_name || null,
        last_name || null,
        computedFullName,
        role || 'Sales User',
        is_active !== undefined ? is_active : true,
        passwordHash,
        true, // Require password change on first login
        reports_to_id || null
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    console.error('Error creating user:', error);
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'User already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user (Corporate Admin, Territory Admin only)
router.put('/:id', authenticateToken, requireRole('Corporate Admin', 'Territory Admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const {
      email,
      first_name,
      last_name,
      full_name,
      role,
      is_active,
      reports_to_id
    } = req.body;

    // Check if user exists
    const existing = await pool.query('SELECT id FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if email already exists (excluding current user)
    if (email) {
      const emailCheck = await pool.query(
        'SELECT id FROM users WHERE email = $1 AND id != $2',
        [email, id]
      );
      if (emailCheck.rows.length > 0) {
        return res.status(400).json({ error: 'Email already exists' });
      }
    }

    const computedFullName = full_name || (first_name && last_name ? `${first_name} ${last_name}` : first_name || last_name);

    const result = await pool.query(
      `UPDATE users SET
        email = COALESCE($1, email),
        first_name = COALESCE($2, first_name),
        last_name = COALESCE($3, last_name),
        full_name = COALESCE($4, full_name),
        role = COALESCE($5, role),
        is_active = COALESCE($6, is_active),
        reports_to_id = COALESCE($7, reports_to_id),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $8
      RETURNING id, email, first_name, last_name, full_name, role, is_active, created_at, updated_at`,
      [
        email, first_name, last_name, computedFullName, role, is_active, reports_to_id, id
      ]
    );

    res.json(result.rows[0]);
  } catch (error: any) {
    console.error('Error updating user:', error);
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete user (Corporate Admin only)
router.delete('/:id', authenticateToken, requireRole('Corporate Admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    // Prevent deleting yourself
    if (req.user?.userId === id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

