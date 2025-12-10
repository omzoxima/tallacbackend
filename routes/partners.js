import express from 'express';
import bcrypt from 'bcryptjs';
import pool from '../config/database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// Get all partners
router.get('/', authenticateToken, async (req, res) => {
  try {
    console.log('Get partners API called');
    const { filters } = req.query;
    console.log('Filters:', filters);

    let query = `
      SELECT 
        id,
        id as name, -- compatibility with Vue3/Python
        partner_code,
        partner_name,
        partner_address,
        partner_city,
        partner_state,
        partner_status,
        partner_email,
        partner_mobile,
        primary_admin_id
      FROM tallac_partners
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    if (filters) {
      const filterObj = typeof filters === 'string' ? JSON.parse(filters) : filters;
      for (const [key, value] of Object.entries(filterObj)) {
        query += ` AND ${key} = $${paramCount}`;
        params.push(value);
        paramCount++;
      }
    }

    query += ` ORDER BY partner_name ASC`;

    const result = await pool.query(query, params);
    const partnerIds = result.rows.map(p => p.id);

    // OPTIMIZED: Batch query all territories for all partners at once
    const allTerritoriesResult = partnerIds.length > 0 ? await pool.query(
      `SELECT 
          pt.partner_id,
          pt.territory_id,
          pt.territory_id as territory,
          t.id as id,
          t.territory_name,
          t.territory_code,
          t.territory_status,
          t.territory_dba,
          t.territory_state,
          t.territory_region
       FROM partner_territories pt
       JOIN tallac_territories t ON pt.territory_id = t.id
       WHERE pt.partner_id = ANY($1)
       ORDER BY pt.partner_id, t.territory_name ASC`,
      [partnerIds]
    ) : { rows: [] };

    // OPTIMIZED: Batch query all zipcode counts for all territories at once
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

    // OPTIMIZED: Batch query all team members for all partners at once
    const allTeamMembersResult = partnerIds.length > 0 ? await pool.query(
      `SELECT 
        ptm.partner_id,
        ptm.tallac_user_id, 
        tu.tallac_role as role, 
        u.full_name as name, 
        u.email, 
        u.mobile_no as phone
       FROM partner_team_members ptm
       JOIN tallac_users tu ON ptm.tallac_user_id = tu.id
       JOIN users u ON tu.user_id = u.id
       WHERE ptm.partner_id = ANY($1)
       ORDER BY ptm.partner_id, u.full_name ASC`,
      [partnerIds]
    ) : { rows: [] };

    // Group territories and team members by partner
    const territoriesByPartner = {};
    for (const territory of allTerritoriesResult.rows) {
      if (!territoriesByPartner[territory.partner_id]) {
        territoriesByPartner[territory.partner_id] = [];
      }
      territoriesByPartner[territory.partner_id].push({
        ...territory,
        zipcode_count: zipCountsMap[territory.territory_id] || 0
      });
    }

    const teamMembersByPartner = {};
    for (const member of allTeamMembersResult.rows) {
      if (!teamMembersByPartner[member.partner_id]) {
        teamMembersByPartner[member.partner_id] = [];
      }
      teamMembersByPartner[member.partner_id].push(member);
    }

    // Enrich partners with batch-queried data
    for (const partner of result.rows) {
      partner.territories = territoriesByPartner[partner.id] || [];
      partner.territory_count = partner.territories.length;

      partner.team_members = teamMembersByPartner[partner.id] || [];
      partner.team_count = partner.team_members.length;

      // Count admins
      partner.admin_count = partner.team_members.filter(m => {
        const role = m.role?.toLowerCase() || '';
        return role.includes('admin') || role.includes('owner') || role.includes('director');
      }).length;
    }

    console.log('Partners response:', JSON.stringify(result.rows, null, 2));
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get partners error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ success: false, message: 'Failed to fetch partners', error: error.message });
  }
});

// Get states filter - MUST be before /:id route
router.get('/filters/states', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT state, state_name
       FROM tallac_zipcodes
       WHERE state IS NOT NULL AND state != ''
       ORDER BY state_name ASC`
    );

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get states error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch states', error: error.message });
  }
});

// Get single partner
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT 
         id,
         id as name,
         partner_code,
         partner_name,
         partner_address,
         partner_city,
         partner_state,
         partner_status,
         partner_email,
         partner_mobile,
         primary_admin_id
       FROM tallac_partners WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Partner not found' });
    }

    const partner = result.rows[0];

    // Get territories
    const territoriesResult = await pool.query(
      `SELECT 
          pt.territory_id,
          pt.territory_id as territory,
          t.id as id,
          t.territory_name,
          t.territory_code,
          t.territory_status,
          t.territory_dba,
          t.territory_state,
          t.territory_region
       FROM partner_territories pt
       JOIN tallac_territories t ON pt.territory_id = t.id
       WHERE pt.partner_id = $1`,
      [id]
    );

    for (const territory of territoriesResult.rows) {
      const zipCountResult = await pool.query(
        `SELECT COUNT(*) as count FROM territory_zipcodes WHERE territory_id = $1`,
        [territory.territory_id]
      );
      territory.zipcode_count = parseInt(zipCountResult.rows[0].count);
    }

    partner.territories = territoriesResult.rows;
    partner.territory_count = territoriesResult.rows.length;

    // Get team members
    const teamResult = await pool.query(
      `SELECT 
        ptm.tallac_user_id, tu.tallac_role as role, u.full_name as name, u.email, u.mobile_no as phone
       FROM partner_team_members ptm
       JOIN tallac_users tu ON ptm.tallac_user_id = tu.id
       JOIN users u ON tu.user_id = u.id
       WHERE ptm.partner_id = $1
       ORDER BY u.full_name ASC`,
      [id]
    );

    partner.team_members = teamResult.rows;
    partner.team_count = teamResult.rows.length;
    partner.admin_count = teamResult.rows.filter(m => {
      const role = m.role?.toLowerCase() || '';
      return role.includes('admin') || role.includes('owner') || role.includes('director');
    }).length;

    res.json({
      success: true,
      data: partner
    });
  } catch (error) {
    console.error('Get partner error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch partner', error: error.message });
  }
});

// Create partner
router.post('/', authenticateToken, requireRole('Corporate Admin'), async (req, res) => {
  try {
    const {
      partner_code, partner_name, partner_address, partner_city,
      partner_state, partner_status, partner_email, partner_mobile,
      team_members, territories, primary_admin_id
    } = req.body;

    if (!partner_code || !partner_name) {
      return res.status(400).json({ 
        success: false, 
        message: 'Validation Failed',
        errors: { partner_code: 'Partner Code is required', partner_name: 'Partner Name is required' }
      });
    }

    // Validate email if provided
    if (partner_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(partner_email)) {
      return res.status(400).json({
        success: false,
        message: 'Validation Failed',
        errors: { partner_email: 'Invalid email format' }
      });
    }

    // Check for duplicate partner code
    const existingResult = await pool.query(
      'SELECT id FROM tallac_partners WHERE partner_code = $1',
      [partner_code]
    );

    if (existingResult.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation Failed',
        errors: { partner_code: 'Partner Code already exists' }
      });
    }

    const result = await pool.query(
      `INSERT INTO tallac_partners 
       (partner_code, partner_name, partner_address, partner_city, partner_state,
        partner_status, partner_email, partner_mobile, primary_admin_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        partner_code, partner_name, partner_address || null, partner_city || null,
        partner_state || null, partner_status || 'Active', partner_email || null,
        partner_mobile || null, primary_admin_id || null
      ]
    );

    const partner = result.rows[0];

    // Add team members if provided
    if (team_members && Array.isArray(team_members)) {
      for (const member of team_members) {
        // Find user by email if tallac_user_id not provided
        let tallacUserId = member.tallac_user_id;
        if (!tallacUserId && member.email) {
          const userResult = await pool.query(
            `SELECT tu.id 
             FROM tallac_users tu
             JOIN users u ON tu.user_id = u.id
             WHERE u.email = $1`,
            [member.email.toLowerCase()]
          );
          if (userResult.rows.length > 0) {
            tallacUserId = userResult.rows[0].id;
          }
        }
        
        if (tallacUserId) {
          await pool.query(
            `INSERT INTO partner_team_members (partner_id, tallac_user_id, member_name, role, email, phone)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (partner_id, tallac_user_id) DO UPDATE
             SET member_name = EXCLUDED.member_name, role = EXCLUDED.role, email = EXCLUDED.email, phone = EXCLUDED.phone`,
            [partner.id, tallacUserId, member.name, member.role, member.email, member.phone]
          );
        }
      }
    }

    // Add territories if provided
    if (territories && Array.isArray(territories)) {
      for (const territory of territories) {
        await pool.query(
          `INSERT INTO partner_territories (partner_id, territory_id)
           VALUES ($1, $2)
           ON CONFLICT (partner_id, territory_id) DO NOTHING`,
          [partner.id, territory.territory || territory]
        );
      }
    }

    // Fetch full partner object with territories and team members (same as GET single partner)
    const fullPartnerResult = await pool.query(
      `SELECT 
         id,
         id as name,
         partner_code,
         partner_name,
         partner_address,
         partner_city,
         partner_state,
         partner_status,
         partner_email,
         partner_mobile,
         primary_admin_id
       FROM tallac_partners WHERE id = $1`,
      [partner.id]
    );

    const fullPartner = fullPartnerResult.rows[0];

    // Get territories
    const territoriesResult = await pool.query(
      `SELECT 
          pt.territory_id,
          pt.territory_id as territory,
          t.id as id,
          t.territory_name,
          t.territory_code,
          t.territory_status,
          t.territory_dba,
          t.territory_state,
          t.territory_region
       FROM partner_territories pt
       JOIN tallac_territories t ON pt.territory_id = t.id
       WHERE pt.partner_id = $1`,
      [partner.id]
    );

    for (const territory of territoriesResult.rows) {
      const zipCountResult = await pool.query(
        `SELECT COUNT(*) as count FROM territory_zipcodes WHERE territory_id = $1`,
        [territory.territory_id]
      );
      territory.zipcode_count = parseInt(zipCountResult.rows[0].count);
    }

    fullPartner.territories = territoriesResult.rows;
    fullPartner.territory_count = territoriesResult.rows.length;

    // Get team members
    const teamResult = await pool.query(
      `SELECT 
        ptm.tallac_user_id, tu.tallac_role as role, u.full_name as name, u.email, u.mobile_no as phone
       FROM partner_team_members ptm
       JOIN tallac_users tu ON ptm.tallac_user_id = tu.id
       JOIN users u ON tu.user_id = u.id
       WHERE ptm.partner_id = $1
       ORDER BY u.full_name ASC`,
      [partner.id]
    );

    fullPartner.team_members = teamResult.rows;
    fullPartner.team_count = teamResult.rows.length;
    fullPartner.admin_count = teamResult.rows.filter(m => {
      const role = m.role?.toLowerCase() || '';
      return role.includes('admin') || role.includes('owner') || role.includes('director');
    }).length;

    res.status(201).json({
      success: true,
      data: fullPartner,
      partner: fullPartner.id,
      partner_name: fullPartner.partner_name
    });
  } catch (error) {
    console.error('Create partner error:', error);
    res.status(500).json({ success: false, message: 'Failed to create partner', error: error.message });
  }
});

// Update partner
router.put('/:id', authenticateToken, requireRole('Corporate Admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const allowedFields = [
      'partner_code', 'partner_name', 'partner_address', 'partner_city',
      'partner_state', 'partner_status', 'partner_email', 'partner_mobile', 'primary_admin_id'
    ];

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
        `UPDATE tallac_partners 
         SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
         WHERE id = $${paramCount}`,
        params
      );
    }

    // Update team members if provided
    if (updates.team_members && Array.isArray(updates.team_members)) {
      await pool.query('DELETE FROM partner_team_members WHERE partner_id = $1', [id]);
      for (const member of updates.team_members) {
        await pool.query(
          `INSERT INTO partner_team_members (partner_id, tallac_user_id, member_name, role, email, phone)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, member.tallac_user_id, member.name, member.role, member.email, member.phone]
        );
      }
    }

    // Update territories if provided
    if (updates.territories && Array.isArray(updates.territories)) {
      await pool.query('DELETE FROM partner_territories WHERE partner_id = $1', [id]);
      for (const territory of updates.territories) {
        await pool.query(
          `INSERT INTO partner_territories (partner_id, territory_id)
           VALUES ($1, $2)`,
          [id, territory.territory || territory]
        );
      }
    }

    res.json({
      success: true,
      message: 'Partner updated successfully'
    });
  } catch (error) {
    console.error('Update partner error:', error);
    res.status(500).json({ success: false, message: 'Failed to update partner', error: error.message });
  }
});

// Delete partner
router.delete('/:id', authenticateToken, requireRole('Corporate Admin'), async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query('DELETE FROM tallac_partners WHERE id = $1', [id]);

    res.json({
      success: true,
      message: 'Partner deleted successfully'
    });
  } catch (error) {
    console.error('Delete partner error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete partner', error: error.message });
  }
});

// Add territories to partner
router.post('/:id/territories', authenticateToken, requireRole('Corporate Admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { territories } = req.body;

    if (!territories || !Array.isArray(territories)) {
      return res.status(400).json({ success: false, message: 'Territories array is required' });
    }

    for (const territoryId of territories) {
      await pool.query(
        `INSERT INTO partner_territories (partner_id, territory_id)
         VALUES ($1, $2)
         ON CONFLICT (partner_id, territory_id) DO NOTHING`,
        [id, territoryId]
      );
    }

    res.json({
      success: true,
      message: 'Territories added successfully',
      partner: id
    });
  } catch (error) {
    console.error('Add territories to partner error:', error);
    res.status(500).json({ success: false, message: 'Failed to add territories', error: error.message });
  }
});

// Create team member
router.post('/:id/team-members', authenticateToken, requireRole('Corporate Admin', 'Territory Admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { user_data, territories } = req.body;

    console.log('\n=== CREATE TEAM MEMBER API CALL ===');
    console.log('Partner ID:', id);
    console.log('Request Body:', JSON.stringify(req.body, null, 2));
    console.log('User Data:', user_data);
    console.log('Territories from body:', territories);
    console.log('Territories from user_data:', user_data?.territories);

    if (!user_data || !user_data.email) {
      console.error('ERROR: Email is required');
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const { email, first_name, last_name, user_role, mobile, send_welcome_email = true } = user_data;

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
      // Create new user
      const password_hash = await bcrypt.hash('temp_password', 10); // User will reset password
      const full_name = `${first_name} ${last_name || ''}`.trim();

      userResult = await pool.query(
        `INSERT INTO users (email, password_hash, first_name, last_name, full_name, mobile_no, "is_active", user_type)
         VALUES ($1, $2, $3, $4, $5, $6, true, 'System User')
         RETURNING id`,
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
      // Update role if changed
      await pool.query(
        'UPDATE tallac_users SET tallac_role = $1 WHERE id = $2',
        [backendRole, tallacUserId]
      );
    }

    // Add territories if provided (check both body.territories and user_data.territories)
    const territoriesToAssign = territories || user_data.territories || [];
    console.log('Territories to assign:', territoriesToAssign);
    
    if (territoriesToAssign && Array.isArray(territoriesToAssign) && territoriesToAssign.length > 0) {
      console.log(`Assigning ${territoriesToAssign.length} territories to user ${tallacUserId}`);
      for (const territoryId of territoriesToAssign) {
        console.log(`  - Assigning territory: ${territoryId}`);
        const result = await pool.query(
          `INSERT INTO assigned_territories (tallac_user_id, territory_id)
           VALUES ($1, $2)
           ON CONFLICT (tallac_user_id, territory_id) DO NOTHING
           RETURNING id`,
          [tallacUserId, territoryId]
        );
        if (result.rows.length > 0) {
          console.log(`    ✓ Territory ${territoryId} assigned successfully`);
        } else {
          console.log(`    ⚠ Territory ${territoryId} already assigned (skipped)`);
        }
      }
    } else {
      console.log('⚠ No territories provided to assign');
    }

    // Add to partner team members
    const userInfo = await pool.query(
      'SELECT full_name, email, mobile_no FROM users WHERE id = $1',
      [userId]
    );

    await pool.query(
      `INSERT INTO partner_team_members (partner_id, tallac_user_id, member_name, role, email, phone)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (partner_id, tallac_user_id) DO UPDATE
       SET member_name = EXCLUDED.member_name, role = EXCLUDED.role, email = EXCLUDED.email, phone = EXCLUDED.phone`,
      [
        id, tallacUserId, userInfo.rows[0].full_name, backendRole,
        userInfo.rows[0].email, userInfo.rows[0].mobile_no
      ]
    );

    // Set as primary admin if Territory Admin and no primary admin exists
    const partnerResult = await pool.query('SELECT primary_admin_id FROM tallac_partners WHERE id = $1', [id]);
    if (backendRole === 'Territory Admin' && !partnerResult.rows[0].primary_admin_id) {
      await pool.query('UPDATE tallac_partners SET primary_admin_id = $1 WHERE id = $2', [tallacUserId, id]);
    }

    // Sync partner territories to primary admin
    if (partnerResult.rows[0].primary_admin_id === tallacUserId) {
      const partnerTerritoriesResult = await pool.query(
        'SELECT territory_id FROM partner_territories WHERE partner_id = $1',
        [id]
      );

      for (const row of partnerTerritoriesResult.rows) {
        await pool.query(
          `INSERT INTO assigned_territories (tallac_user_id, territory_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [tallacUserId, row.territory_id]
        );
      }
    }

    console.log('=== TEAM MEMBER CREATED SUCCESSFULLY ===');
    console.log('User ID:', userId);
    console.log('Tallac User ID:', tallacUserId);
    console.log('Territories assigned:', territoriesToAssign.length);
    
    // Fetch full partner object with territories and team members (same as GET single partner)
    const fullPartnerResult = await pool.query(
      `SELECT 
         id,
         id as name,
         partner_code,
         partner_name,
         partner_address,
         partner_city,
         partner_state,
         partner_status,
         partner_email,
         partner_mobile,
         primary_admin_id
       FROM tallac_partners WHERE id = $1`,
      [id]
    );

    const fullPartner = fullPartnerResult.rows[0];

    // Get territories
    const territoriesResult = await pool.query(
      `SELECT 
          pt.territory_id,
          pt.territory_id as territory,
          t.id as id,
          t.territory_name,
          t.territory_code,
          t.territory_status,
          t.territory_dba,
          t.territory_state,
          t.territory_region
       FROM partner_territories pt
       JOIN tallac_territories t ON pt.territory_id = t.id
       WHERE pt.partner_id = $1`,
      [id]
    );

    for (const territory of territoriesResult.rows) {
      const zipCountResult = await pool.query(
        `SELECT COUNT(*) as count FROM territory_zipcodes WHERE territory_id = $1`,
        [territory.territory_id]
      );
      territory.zipcode_count = parseInt(zipCountResult.rows[0].count);
    }

    fullPartner.territories = territoriesResult.rows;
    fullPartner.territory_count = territoriesResult.rows.length;

    // Get team members
    const teamResult = await pool.query(
      `SELECT 
        ptm.tallac_user_id, tu.tallac_role as role, u.full_name as name, u.email, u.mobile_no as phone
       FROM partner_team_members ptm
       JOIN tallac_users tu ON ptm.tallac_user_id = tu.id
       JOIN users u ON tu.user_id = u.id
       WHERE ptm.partner_id = $1
       ORDER BY u.full_name ASC`,
      [id]
    );

    fullPartner.team_members = teamResult.rows;
    fullPartner.team_count = teamResult.rows.length;
    fullPartner.admin_count = teamResult.rows.filter(m => {
      const role = m.role?.toLowerCase() || '';
      return role.includes('admin') || role.includes('owner') || role.includes('director');
    }).length;
    
    res.json({
      success: true,
      message: `${user_role} created successfully`,
      data: fullPartner,
      user: email,
      tallac_user: email,
      action: 'created',
      territories_assigned: territoriesToAssign.length
    });
  } catch (error) {
    console.error('Create team member error:', error);
    res.status(500).json({ success: false, message: 'Failed to create team member', error: error.message });
  }
});

// Set primary admin
router.put('/:id/primary-admin', authenticateToken, requireRole('Corporate Admin', 'Territory Admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { new_primary_admin_email } = req.body;

    // Verify user is team member
    const teamMemberResult = await pool.query(
      `SELECT ptm.tallac_user_id, tu.tallac_role
       FROM partner_team_members ptm
       JOIN tallac_users tu ON ptm.tallac_user_id = tu.id
       JOIN users u ON tu.user_id = u.id
       WHERE ptm.partner_id = $1 AND u.email = $2`,
      [id, new_primary_admin_email]
    );

    if (teamMemberResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'User is not a team member' });
    }

    if (teamMemberResult.rows[0].tallac_role !== 'Territory Admin') {
      return res.status(400).json({ success: false, message: 'Only Territory Admins can be Primary Admin' });
    }

    const tallacUserId = teamMemberResult.rows[0].tallac_user_id;

    // Update primary admin
    await pool.query(
      'UPDATE tallac_partners SET primary_admin_id = $1 WHERE id = $2',
      [tallacUserId, id]
    );

    // Sync all partner territories to primary admin
    const partnerTerritoriesResult = await pool.query(
      'SELECT territory_id FROM partner_territories WHERE partner_id = $1',
      [id]
    );

    for (const row of partnerTerritoriesResult.rows) {
      await pool.query(
        `INSERT INTO assigned_territories (tallac_user_id, territory_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [tallacUserId, row.territory_id]
      );
    }

    res.json({
      success: true,
      message: `Primary Admin updated and synced with ${partnerTerritoriesResult.rows.length} territories`
    });
  } catch (error) {
    console.error('Set primary admin error:', error);
    res.status(500).json({ success: false, message: 'Failed to set primary admin', error: error.message });
  }
});

export default router;

