import express from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../config/database';
import { authenticateToken, requireRole, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Get all partners with territories and team members
router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { search, status, limit = 1000, offset = 0 } = req.query;

    let query = `
      SELECT 
        p.*,
        COUNT(DISTINCT pt.territory_id) as territory_count,
        COUNT(DISTINCT ptm.id) as team_count
      FROM tallac_partners p
      LEFT JOIN partner_territories pt ON p.id = pt.partner_id
      LEFT JOIN partner_team_members ptm ON p.id = ptm.partner_id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramCount = 0;

    if (search) {
      paramCount++;
      query += ` AND (p.partner_name ILIKE $${paramCount} OR p.partner_code ILIKE $${paramCount} OR p.partner_address ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    if (status && status !== 'all') {
      paramCount++;
      query += ` AND p.partner_status = $${paramCount}`;
      params.push(status);
    }

    query += ` GROUP BY p.id ORDER BY p.partner_name ASC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(parseInt(limit as string), parseInt(offset as string));

    const result = await pool.query(query, params);

    // Performance optimization: Fetch all territories and team members in parallel queries instead of N+1
    const partnerIds = result.rows.map(p => p.id);
    
    const [territoriesResult, teamMembersResult] = await Promise.all([
      // Get all territories for all partners in one query
      partnerIds.length > 0 ? pool.query(`
        SELECT 
          pt.partner_id,
          t.id as territory_id,
          t.territory_name,
          t.territory_code,
          t.territory_status,
          t.territory_dba,
          t.territory_state,
          t.territory_region,
          COUNT(DISTINCT tzc.id) as zipcode_count
        FROM partner_territories pt
        JOIN tallac_territories t ON pt.territory_id = t.id
        LEFT JOIN territory_zip_codes tzc ON t.id = tzc.territory_id
        WHERE pt.partner_id = ANY($1)
        GROUP BY pt.partner_id, t.id, t.territory_name, t.territory_code, t.territory_status, t.territory_dba, t.territory_state, t.territory_region
        ORDER BY pt.partner_id, t.territory_name
      `, [partnerIds]) : Promise.resolve({ rows: [] }),
      
      // Get all team members for all partners in one query
      partnerIds.length > 0 ? pool.query(`
        SELECT 
          ptm.partner_id,
          ptm.member_name as name,
          ptm.role,
          ptm.email,
          ptm.phone,
          u.id as user_id,
          u.full_name,
          u.email as user_email
        FROM partner_team_members ptm
        LEFT JOIN users u ON ptm.tallac_user_id = u.id
        WHERE ptm.partner_id = ANY($1)
        ORDER BY ptm.partner_id, ptm.member_name
      `, [partnerIds]) : Promise.resolve({ rows: [] })
    ]);
    
    // Group territories and team members by partner_id
    const territoriesByPartnerId: Record<string, any[]> = {};
    territoriesResult.rows.forEach((t: any) => {
      if (!territoriesByPartnerId[t.partner_id]) {
        territoriesByPartnerId[t.partner_id] = [];
      }
      territoriesByPartnerId[t.partner_id].push({
        territory: t.territory_id,
        territory_name: t.territory_name,
        territory_code: t.territory_code,
        territory_status: t.territory_status,
        territory_dba: t.territory_dba,
        territory_state: t.territory_state,
        territory_region: t.territory_region,
        zipcode_count: parseInt(t.zipcode_count) || 0
      });
    });
    
    const teamMembersByPartnerId: Record<string, any[]> = {};
    teamMembersResult.rows.forEach((tm: any) => {
      if (!teamMembersByPartnerId[tm.partner_id]) {
        teamMembersByPartnerId[tm.partner_id] = [];
      }
      teamMembersByPartnerId[tm.partner_id].push({
        name: tm.name || tm.full_name,
        role: tm.role,
        email: tm.email || tm.user_email,
        phone: tm.phone
      });
    });
    
    // Map partners with their territories and team members
    const partners = result.rows.map((partner) => {
      const territories = territoriesByPartnerId[partner.id] || [];
      const teamMembers = teamMembersByPartnerId[partner.id] || [];
      const adminCount = teamMembers.filter(m => {
        const roleLower = (m.role || '').toLowerCase();
        return roleLower.includes('admin') || roleLower.includes('owner') || roleLower.includes('director');
      }).length;

      return {
        ...partner,
        territories,
        territory_count: territories.length,
        team_members: teamMembers,
        team_count: teamMembers.length,
        admin_count: adminCount
      };
    });

    res.json(partners);
  } catch (error) {
    console.error('Error fetching partners:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single partner
router.get('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      'SELECT * FROM tallac_partners WHERE id = $1 OR name = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Partner not found' });
    }

    const partner = result.rows[0];

    // Performance optimization: Fetch territories and team members in parallel
    const [territoriesResult, teamMembersResult] = await Promise.all([
      pool.query(`
        SELECT 
          t.id as territory_id,
          t.territory_name,
          t.territory_code,
          t.territory_status,
          t.territory_dba,
          t.territory_state,
          t.territory_region,
          COUNT(DISTINCT tzc.id) as zipcode_count
        FROM partner_territories pt
        JOIN tallac_territories t ON pt.territory_id = t.id
        LEFT JOIN territory_zip_codes tzc ON t.id = tzc.territory_id
        WHERE pt.partner_id = $1
        GROUP BY t.id, t.territory_name, t.territory_code, t.territory_status, t.territory_dba, t.territory_state, t.territory_region
        ORDER BY t.territory_name
      `, [partner.id]),
      
      pool.query(`
        SELECT 
          ptm.member_name as name,
          ptm.role,
          ptm.email,
          ptm.phone,
          u.id as user_id,
          u.full_name,
          u.email as user_email
        FROM partner_team_members ptm
        LEFT JOIN users u ON ptm.tallac_user_id = u.id
        WHERE ptm.partner_id = $1
        ORDER BY ptm.member_name
      `, [partner.id])
    ]);

    const territories = territoriesResult.rows.map(t => ({
      territory: t.territory_id,
      territory_name: t.territory_name,
      territory_code: t.territory_code,
      territory_status: t.territory_status,
      territory_dba: t.territory_dba,
      territory_state: t.territory_state,
      territory_region: t.territory_region,
      zipcode_count: parseInt(t.zipcode_count) || 0
    }));

    const teamMembers = teamMembersResult.rows.map(tm => ({
      name: tm.name || tm.full_name,
      role: tm.role,
      email: tm.email || tm.user_email,
      phone: tm.phone
    }));

    const adminCount = teamMembers.filter(m => {
      const roleLower = (m.role || '').toLowerCase();
      return roleLower.includes('admin') || roleLower.includes('owner') || roleLower.includes('director');
    }).length;

    res.json({
      ...partner,
      territories,
      territory_count: territories.length,
      team_members: teamMembers,
      team_count: teamMembers.length,
      admin_count: adminCount
    });
  } catch (error) {
    console.error('Error fetching partner:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create partner (Corporate Admin only)
router.post('/', authenticateToken, requireRole('Corporate Admin'), async (req: AuthRequest, res) => {
  try {
    const {
      partner_code,
      partner_name,
      partner_address,
      partner_city,
      partner_state,
      partner_status,
      partner_email,
      partner_mobile
    } = req.body;

    if (!partner_code || !partner_name) {
      return res.status(400).json({ error: 'Partner code and name are required' });
    }

    // Generate name (PART-00001 format)
    const nameQuery = await pool.query(
      'SELECT COUNT(*) as count FROM tallac_partners'
    );
    const count = parseInt(nameQuery.rows[0].count) + 1;
    const name = `PART-${String(count).padStart(5, '0')}`;

    const result = await pool.query(`
      INSERT INTO tallac_partners (
        name, partner_code, partner_name, partner_address, partner_city,
        partner_state, partner_status, partner_email, partner_mobile
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      name, partner_code, partner_name, partner_address || null,
      partner_city || null, partner_state || null,
      partner_status || 'Active', partner_email || null, partner_mobile || null
    ]);

    res.status(201).json({
      success: true,
      partner: result.rows[0].name,
      partner_name: result.rows[0].partner_name
    });
  } catch (error: any) {
    console.error('Error creating partner:', error);
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'Partner code or name already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update partner (Corporate Admin only)
router.put('/:id', authenticateToken, requireRole('Corporate Admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const partnerData = req.body;

    const updateFields: string[] = [];
    const values: any[] = [];
    let paramCount = 0;

    Object.keys(partnerData).forEach((key) => {
      if (key !== 'id' && key !== 'name' && key !== 'created_at' && key !== 'territories' && key !== 'team_members') {
        paramCount++;
        updateFields.push(`${key} = $${paramCount}`);
        values.push(partnerData[key]);
      }
    });

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    paramCount++;
    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const query = `
      UPDATE tallac_partners
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount} OR name = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Partner not found' });
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error updating partner:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Partner code or name already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete partner (Corporate Admin only)
router.delete('/:id', authenticateToken, requireRole('Corporate Admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM tallac_partners WHERE id = $1 OR name = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Partner not found' });
    }

    res.json({ success: true, message: 'Partner deleted successfully' });
  } catch (error) {
    console.error('Error deleting partner:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add territories to partner
router.post('/:id/territories', authenticateToken, requireRole('Corporate Admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { territories } = req.body; // Array of territory IDs or names

    if (!Array.isArray(territories) || territories.length === 0) {
      return res.status(400).json({ error: 'Territories array is required' });
    }

    // Get partner ID
    const partnerResult = await pool.query(
      'SELECT id FROM tallac_partners WHERE id::text = $1 OR name = $1',
      [id]
    );

    if (partnerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Partner not found' });
    }

    const partnerId = partnerResult.rows[0].id;

    // Add territories (skip if already exists)
    for (const territoryIdentifier of territories) {
      // Check if territory exists (by id or name)
      const territoryCheck = await pool.query(
        'SELECT id FROM tallac_territories WHERE id::text = $1 OR territory_name = $1',
        [territoryIdentifier]
      );
      
      if (territoryCheck.rows.length > 0) {
        const actualTerritoryId = territoryCheck.rows[0].id;
        await pool.query(`
          INSERT INTO partner_territories (partner_id, territory_id)
          VALUES ($1, $2)
          ON CONFLICT (partner_id, territory_id) DO NOTHING
        `, [partnerId, actualTerritoryId]);
      }
    }

    res.json({
      success: true,
      message: 'Territories added successfully',
      partner: partnerResult.rows[0].id
    });
  } catch (error) {
    console.error('Error adding territories to partner:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add team member to partner
router.post('/:id/team-members', authenticateToken, requireRole('Corporate Admin'), async (req: AuthRequest, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const {
      user_id, // If provided, use existing user
      member_name,
      role,
      email,
      phone,
      role_title,
      telephony_number,
      telephony_type,
      telephony_carrier,
      territories = [],
      send_welcome_email = true
    } = req.body;

    // Get partner ID
    const partnerResult = await client.query(
      'SELECT id FROM tallac_partners WHERE id::text = $1 OR name = $1',
      [id]
    );

    if (partnerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Partner not found' });
    }

    const partnerId = partnerResult.rows[0].id;

    let userId = user_id;

    // If user_id not provided, create new user
    if (!userId) {
      if (!email) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Email is required to create a new user' });
      }

      // Check if user already exists
      const existingUser = await client.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existingUser.rows.length > 0) {
        userId = existingUser.rows[0].id;
      } else {
        // Create new user
        const defaultPassword = '12345';
        const passwordHash = await bcrypt.hash(defaultPassword, 10);

        // Parse first_name and last_name from member_name
        const nameParts = (member_name || '').trim().split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';
        const fullName = member_name || email;

        const normalizedFirstName = firstName || (fullName?.split(' ')[0]) || email;
        const normalizedLastName = lastName || (fullName?.split(' ').slice(1).join(' ').trim() || '');

        const userResult = await client.query(
          `INSERT INTO users (
            email, first_name, last_name, full_name, role, tallac_role, mobile_no, is_active, password_hash,
            password_change_required, "firstName", "lastName", active
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          RETURNING id`,
          [
            email,
            normalizedFirstName,
            normalizedLastName,
            fullName,
            role || 'Sales User',
            role || 'Sales User',
            phone || null,
            true,
            passwordHash,
            true, // Require password change on first login
            normalizedFirstName,
            normalizedLastName,
            true
          ]
        );

        userId = userResult.rows[0].id;

        // Create and assign telephony line if provided
        if (telephony_number && telephony_type) {
          const telephonyResult = await client.query(
            `INSERT INTO telephony_lines (line_name, phone_number, provider, is_active)
             VALUES ($1, $2, $3, $4)
             RETURNING id`,
            [
              `Line for ${email}`,
              telephony_number,
              telephony_carrier || null,
              true
            ]
          );

          const telephonyLineId = telephonyResult.rows[0].id;

          // Assign to user
          await client.query(
            `INSERT INTO user_telephony_assignments (user_id, telephony_line_id)
             VALUES ($1, $2)
             ON CONFLICT (user_id, telephony_line_id) DO NOTHING`,
            [userId, telephonyLineId]
          );
        }

        // Assign territories if provided
        if (Array.isArray(territories) && territories.length > 0) {
          for (const territoryId of territories) {
            // Check if territory exists (by id or name)
        const territoryCheck = await client.query(
          'SELECT id FROM tallac_territories WHERE id::text = $1 OR territory_name = $1',
          [territoryId]
        );
            if (territoryCheck.rows.length > 0) {
              const actualTerritoryId = territoryCheck.rows[0].id;
              await client.query(
                `INSERT INTO user_territory_assignments (user_id, territory_id)
                 VALUES ($1, $2)
                 ON CONFLICT (user_id, territory_id) DO NOTHING`,
                [userId, actualTerritoryId]
              );
            }
          }
        }
      }
    }

    // Add team member to partner_team_members table
    await client.query(`
      INSERT INTO partner_team_members (partner_id, tallac_user_id, member_name, role, email, phone)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (partner_id, tallac_user_id) DO UPDATE SET
        member_name = EXCLUDED.member_name,
        role = EXCLUDED.role,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone
    `, [partnerId, userId, member_name || email, role, email, phone || null]);

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Team member added successfully',
      user_id: userId
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error adding team member to partner:', error);
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'User already exists or team member already assigned' });
    }
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

export default router;

