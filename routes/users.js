import express from 'express';
import bcrypt from 'bcryptjs';
import pool from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get all users
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { filters } = req.query;

    let query = `
      SELECT 
        tu.id, tu.user_id, tu.tallac_role, tu.status, tu.reports_to,
        u.email, u.first_name, u.last_name, u.full_name, u.mobile_no
      FROM tallac_users tu
      JOIN users u ON tu.user_id = u.id
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    if (filters) {
      const filterObj = typeof filters === 'string' ? JSON.parse(filters) : filters;
      for (const [key, value] of Object.entries(filterObj)) {
        if (key === 'tallac_role' || key === 'status') {
          query += ` AND tu.${key} = $${paramCount}`;
        } else {
          query += ` AND u.${key} = $${paramCount}`;
        }
        params.push(value);
        paramCount++;
      }
    }

    query += ` ORDER BY u.full_name ASC`;

    const result = await pool.query(query, params);

    // OPTIMIZED: Batch query all related data at once (instead of N+1 queries)
    const tallacUserIds = result.rows.map(u => u.id);
    const userIds = result.rows.map(u => u.user_id);

    // Batch get all territories for all users
    const allTerritoriesResult = tallacUserIds.length > 0 ? await pool.query(
      `SELECT at.tallac_user_id, at.territory_id, t.territory_name, t.territory_code, t.territory_status,
              t.territory_dba, t.territory_state, t.territory_region
       FROM assigned_territories at
       JOIN tallac_territories t ON at.territory_id = t.id
       WHERE at.tallac_user_id = ANY($1)`,
      [tallacUserIds]
    ) : { rows: [] };

    // Batch get zipcode counts for all territories
    const territoryIds = [...new Set(allTerritoriesResult.rows.map(t => t.territory_id))];
    const zipCountsResult = territoryIds.length > 0 ? await pool.query(
      `SELECT territory_id, COUNT(*) as count 
       FROM territory_zipcodes 
       WHERE territory_id = ANY($1)
       GROUP BY territory_id`,
      [territoryIds]
    ) : { rows: [] };
    const zipCountsMap = {};
    for (const row of zipCountsResult.rows) {
      zipCountsMap[row.territory_id] = parseInt(row.count);
    }

    // Batch get all telephony lines (telephony_lines table doesn't have status column)
    const allTelephonyResult = tallacUserIds.length > 0 ? await pool.query(
      `SELECT atl.tallac_user_id, tl.id, tl.line_name, tl.phone_number, tl.provider, COALESCE(tl.is_active, tl.active, true) as is_active
       FROM assigned_telephony_lines atl
       JOIN telephony_lines tl ON atl.telephony_line_id = tl.id
       WHERE atl.tallac_user_id = ANY($1)`,
      [tallacUserIds]
    ) : { rows: [] };

    // Batch get reports_to details
    const reportsToIds = result.rows.filter(u => u.reports_to).map(u => u.reports_to);
    const managersResult = reportsToIds.length > 0 ? await pool.query(
      `SELECT tu.id, u.full_name, u.email, tu.tallac_role
       FROM tallac_users tu
       JOIN users u ON tu.user_id = u.id
       WHERE tu.id = ANY($1)`,
      [reportsToIds]
    ) : { rows: [] };
    const managersMap = {};
    for (const manager of managersResult.rows) {
      managersMap[manager.id] = manager;
    }

    // Batch get prospect counts
    const prospectCountsResult = userIds.length > 0 ? await pool.query(
      `SELECT assigned_to_id, COUNT(*) as count 
       FROM tallac_prospects 
       WHERE assigned_to_id = ANY($1)
       GROUP BY assigned_to_id`,
      [userIds]
    ) : { rows: [] };
    const prospectCountsMap = {};
    for (const row of prospectCountsResult.rows) {
      prospectCountsMap[row.assigned_to_id] = parseInt(row.count);
    }

    // Batch get activity counts
    const activityCountsResult = userIds.length > 0 ? await pool.query(
      `SELECT assigned_to_id, COUNT(*) as count 
       FROM tallac_activities 
       WHERE assigned_to_id = ANY($1)
       GROUP BY assigned_to_id`,
      [userIds]
    ) : { rows: [] };
    const activityCountsMap = {};
    for (const row of activityCountsResult.rows) {
      activityCountsMap[row.assigned_to_id] = parseInt(row.count);
    }

    // Group territories and telephony by user
    const territoriesByUser = {};
    for (const territory of allTerritoriesResult.rows) {
      if (!territoriesByUser[territory.tallac_user_id]) {
        territoriesByUser[territory.tallac_user_id] = [];
      }
      territoriesByUser[territory.tallac_user_id].push({
        ...territory,
        zipcode_count: zipCountsMap[territory.territory_id] || 0
      });
    }

    const telephonyByUser = {};
    for (const line of allTelephonyResult.rows) {
      if (!telephonyByUser[line.tallac_user_id]) {
        telephonyByUser[line.tallac_user_id] = [];
      }
      telephonyByUser[line.tallac_user_id].push(line);
    }

    // Enrich users with batch-queried data
    for (const user of result.rows) {
      user.territories = territoriesByUser[user.id] || [];
      user.territory_count = user.territories.length;
      user.telephony_lines = telephonyByUser[user.id] || [];
      user.telephony_count = user.telephony_lines.length;

      if (user.reports_to && managersMap[user.reports_to]) {
        const manager = managersMap[user.reports_to];
        user.reports_to_name = manager.full_name;
        user.reports_to_email = manager.email;
      }

      user.prospect_count = prospectCountsMap[user.user_id] || 0;
      user.activity_count = activityCountsMap[user.user_id] || 0;
    }

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch users', error: error.message });
  }
});

// Get single user
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT 
        tu.id, tu.user_id, tu.tallac_role, tu.status, tu.reports_to,
        u.email, u.first_name, u.last_name, u.full_name, u.mobile_no
      FROM tallac_users tu
      JOIN users u ON tu.user_id = u.id
      WHERE tu.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = result.rows[0];

    // Get territories
    const territoriesResult = await pool.query(
      `SELECT at.territory_id, t.territory_name, t.territory_code, t.territory_status,
              t.territory_dba, t.territory_state, t.territory_region
       FROM assigned_territories at
       JOIN tallac_territories t ON at.territory_id = t.id
       WHERE at.tallac_user_id = $1`,
      [id]
    );

    for (const territory of territoriesResult.rows) {
      const zipCountResult = await pool.query(
        `SELECT COUNT(*) as count FROM territory_zipcodes WHERE territory_id = $1`,
        [territory.territory_id]
      );
      territory.zipcode_count = parseInt(zipCountResult.rows[0].count);
    }

    user.territories = territoriesResult.rows;
    user.territory_count = territoriesResult.rows.length;

    // Get telephony lines
    const telephonyResult = await pool.query(
      `SELECT tl.id, tl.line_name, tl.phone_number, tl.provider, tl.status
       FROM assigned_telephony_lines atl
       JOIN telephony_lines tl ON atl.telephony_line_id = tl.id
       WHERE atl.tallac_user_id = $1`,
      [id]
    );

    user.telephony_lines = telephonyResult.rows;
    user.telephony_count = telephonyResult.rows.length;

    // Get reports to details
    if (user.reports_to) {
      const managerResult = await pool.query(
        `SELECT tu.id, u.full_name, u.email, tu.tallac_role
         FROM tallac_users tu
         JOIN users u ON tu.user_id = u.id
         WHERE tu.id = $1`,
        [user.reports_to]
      );

      if (managerResult.rows.length > 0) {
        user.reports_to_details = {
          name: managerResult.rows[0].id,
          full_name: managerResult.rows[0].full_name,
          email: managerResult.rows[0].email,
          tallac_role: managerResult.rows[0].tallac_role
        };
      }
    }

    // Get assigned prospects
    const prospectsResult = await pool.query(
      `SELECT id, prospect_code, status
       FROM tallac_prospects
       WHERE assigned_to_id = $1
       LIMIT 100`,
      [user.user_id]
    );

    user.prospects = prospectsResult.rows;
    user.prospect_count = prospectsResult.rows.length;

    // Get activities
    const activitiesResult = await pool.query(
      `SELECT id, activity_code, activity_type, subject, status, date_time
       FROM tallac_activities
       WHERE assigned_to_id = $1
       ORDER BY date_time DESC
       LIMIT 50`,
      [user.user_id]
    );

    user.activities = activitiesResult.rows;
    user.activity_count = activitiesResult.rows.length;

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch user', error: error.message });
  }
});

// Get current user info
router.get('/me/info', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get tallac user profile
    const tallacUserResult = await pool.query(
      `SELECT tu.id, tu.tallac_role, tu.status, tu.reports_to
       FROM tallac_users tu
       WHERE tu.user_id = $1`,
      [userId]
    );

    if (tallacUserResult.rows.length === 0) {
      // Return basic info if no tallac profile
      const userResult = await pool.query(
        `SELECT id, email, first_name, last_name, full_name FROM users WHERE id = $1`,
        [userId]
      );

      return res.json({
        success: true,
        data: {
          name: userResult.rows[0].email,
          full_name: userResult.rows[0].full_name,
          email: userResult.rows[0].email,
          tallac_role: 'System User',
          territories: [],
          territory_count: 0
        }
      });
    }

    const tallacUser = tallacUserResult.rows[0];

    // Get territories
    const territoriesResult = await pool.query(
      `SELECT t.id, t.territory_code, t.territory_name
       FROM assigned_territories at
       JOIN tallac_territories t ON at.territory_id = t.id
       WHERE at.tallac_user_id = $1`,
      [tallacUser.id]
    );

    res.json({
      success: true,
      data: {
        name: req.user.email,
        full_name: req.user.full_name,
        email: req.user.email,
        tallac_role: tallacUser.tallac_role,
        status: tallacUser.status,
        territories: territoriesResult.rows,
        territory_count: territoriesResult.rows.length
      }
    });
  } catch (error) {
    console.error('Get current user info error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch user info', error: error.message });
  }
});

// Create user
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { user_data } = req.body;

    if (!user_data || !user_data.email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const { email, first_name, last_name, user_role, mobile, territories, send_welcome_email = true } = user_data;

    // Map frontend role to backend role
    const roleMapping = {
      'Corporate Admin': 'Corporate Admin',
      'Business Coach': 'Business Coach',
      'Territory Admin': 'Territory Admin',
      'Territory Manager': 'Territory Manager',
      'Tallac User': 'Sales User'
    };

    const backendRole = roleMapping[user_role] || 'Sales User';

    // Check if user exists
    let userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    let userId;

    if (userResult.rows.length === 0) {
      // Create new user with default password Admin@123
      const defaultPassword = 'Admin@123';
      const password_hash = await bcrypt.hash(defaultPassword, 10);
      const full_name = `${first_name} ${last_name || ''}`.trim();

      userResult = await pool.query(
        `INSERT INTO users (email, password_hash, "passwordHash", first_name, "firstName", last_name, "lastName", full_name, mobile_no, phone, "is_active", active, user_type)
         VALUES ($1, $2, $2, $3, $3, $4, $4, $5, $6, $6, true, true, 'System User')
         RETURNING id, email, first_name, last_name, full_name`,
        [email.toLowerCase(), password_hash, first_name, last_name, full_name, mobile || null]
      );
      userId = userResult.rows[0].id;
    } else {
      userId = userResult.rows[0].id;
    }

    // Check if tallac user exists
    let tallacUserResult = await pool.query(
      'SELECT id FROM tallac_users WHERE user_id = $1',
      [userId]
    );
    let tallacUserId;

    if (tallacUserResult.rows.length === 0) {
      tallacUserResult = await pool.query(
        `INSERT INTO tallac_users (user_id, tallac_role, status)
         VALUES ($1, $2, 'Active')
         RETURNING id`,
        [userId, backendRole]
      );
      tallacUserId = tallacUserResult.rows[0].id;
    } else {
      tallacUserId = tallacUserResult.rows[0].id;
      // Update role
      await pool.query(
        'UPDATE tallac_users SET tallac_role = $1, status = $2 WHERE id = $3',
        [backendRole, 'Active', tallacUserId]
      );
    }

    // Add territories if provided
    if (territories && Array.isArray(territories) && territories.length > 0) {
      // Clear existing territories
      await pool.query('DELETE FROM assigned_territories WHERE tallac_user_id = $1', [tallacUserId]);

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
      user: email,
      tallac_user: email,
      email: email,
      full_name: userResult.rows[0].full_name,
      role: user_role
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ success: false, message: 'Failed to create user', error: error.message });
  }
});

// Update user
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const allowedFields = ['tallac_role', 'status', 'reports_to'];

    const updateFields = [];
    const params = [];
    let paramCount = 1;

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        updateFields.push(`${field} = $${paramCount}`);
        params.push(updates[field]);
        paramCount++;
      }
    }

    if (updateFields.length > 0) {
      params.push(id);
      await pool.query(
        `UPDATE tallac_users 
         SET ${updateFields.join(', ')}
         WHERE id = $${paramCount}`,
        params
      );
    }

    // Update territories if provided
    if (updates.territories && Array.isArray(updates.territories)) {
      await pool.query('DELETE FROM assigned_territories WHERE tallac_user_id = $1', [id]);

      for (const territoryId of updates.territories) {
        await pool.query(
          `INSERT INTO assigned_territories (tallac_user_id, territory_id)
           VALUES ($1, $2)`,
          [id, territoryId]
        );
      }
    }

    // Update telephony lines if provided
    if (updates.telephony_lines && Array.isArray(updates.telephony_lines)) {
      await pool.query('DELETE FROM assigned_telephony_lines WHERE tallac_user_id = $1', [id]);

      for (const lineId of updates.telephony_lines) {
        await pool.query(
          `INSERT INTO assigned_telephony_lines (tallac_user_id, telephony_line_id)
           VALUES ($1, $2)`,
          [id, lineId]
        );
      }
    }

    res.json({
      success: true,
      message: 'User updated successfully'
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ success: false, message: 'Failed to update user', error: error.message });
  }
});

// Delete user
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Get user_id first
    const userResult = await pool.query('SELECT user_id FROM tallac_users WHERE id = $1', [id]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Delete tallac user (cascade will handle child tables)
    await pool.query('DELETE FROM tallac_users WHERE id = $1', [id]);

    // Optionally delete the base user (uncomment if needed)
    // await pool.query('DELETE FROM users WHERE id = $1', [userResult.rows[0].user_id]);

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete user', error: error.message });
  }
});

// Get users for assignment
router.get('/assignment/list', authenticateToken, async (req, res) => {
  try {
    const { territory } = req.query;

    let query = `
      SELECT tu.id, u.full_name, u.email, tu.user_id, tu.tallac_role
      FROM tallac_users tu
      JOIN users u ON tu.user_id = u.id
      WHERE tu.tallac_role IN ('Territory Admin', 'Territory Manager', 'Sales User')
        AND tu.status = 'Active'
    `;

    const params = [];

    if (territory) {
      query += ` AND tu.id IN (
        SELECT tallac_user_id FROM assigned_territories WHERE territory_id = $1
      )`;
      params.push(territory);
    }

    query += ` ORDER BY u.full_name ASC`;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get users for assignment error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch users', error: error.message });
  }
});

export default router;

