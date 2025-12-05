import express from 'express';
import { pool } from '../config/database';
import { authenticateToken, requireRole, AuthRequest } from '../middleware/auth';

const router = express.Router();

/**
 * GET /api/organizations
 * Get all organizations with optional search and filtering
 * Matches: tallac.api.prospects.get_or_create_organization
 */
router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { 
      search, 
      limit = 500, 
      offset = 0,
      status,
      industry,
      territory_id,
      city,
      state
    } = req.query;

    let query = `
      SELECT 
        o.*,
        t.territory_name,
        c.full_name as primary_contact_name,
        c.email as primary_contact_email,
        c.phone as primary_contact_phone,
        u.full_name as owner_name,
        (SELECT COUNT(*) FROM tallac_organization_contacts oc WHERE oc.organization_id = o.id) as contact_count,
        (SELECT COUNT(*) FROM tallac_leads l WHERE l.organization_id = o.id) as prospect_count
      FROM tallac_organizations o
      LEFT JOIN tallac_territories t ON o.territory_id = t.id
      LEFT JOIN tallac_contacts c ON o.primary_contact_id = c.id
      LEFT JOIN users u ON o.organization_owner_id = u.id
      WHERE 1=1
    `;
    
    const params: any[] = [];
    let paramCount = 1;

    // Search filter
    if (search && typeof search === 'string') {
      query += ` AND (
        o.organization_name ILIKE $${paramCount} 
        OR o.doing_business_as ILIKE $${paramCount}
        OR o.city ILIKE $${paramCount}
        OR o.overview ILIKE $${paramCount}
      )`;
      params.push(`%${search}%`);
      paramCount++;
    }

    // Status filter
    if (status && typeof status === 'string') {
      query += ` AND o.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    // Industry filter
    if (industry && typeof industry === 'string') {
      query += ` AND o.industry = $${paramCount}`;
      params.push(industry);
      paramCount++;
    }

    // Territory filter
    if (territory_id && typeof territory_id === 'string') {
      query += ` AND o.territory_id = $${paramCount}`;
      params.push(territory_id);
      paramCount++;
    }

    // City filter
    if (city && typeof city === 'string') {
      query += ` AND o.city = $${paramCount}`;
      params.push(city);
      paramCount++;
    }

    // State filter
    if (state && typeof state === 'string') {
      query += ` AND o.state = $${paramCount}`;
      params.push(state);
      paramCount++;
    }

    query += ` ORDER BY o.organization_name ASC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(parseInt(limit as string), parseInt(offset as string));

    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching organizations:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

/**
 * GET /api/organizations/:id
 * Get single organization by ID with all related data
 * Matches: frappe.get_doc('Tallac Organization', org_id)
 */
router.get('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    // Get organization details
    const orgResult = await pool.query(`
      SELECT 
        o.*,
        t.territory_name,
        c.full_name as primary_contact_name,
        c.email as primary_contact_email,
        c.phone as primary_contact_phone,
        c.job_title as primary_contact_title,
        u.full_name as owner_name,
        u.email as owner_email
      FROM tallac_organizations o
      LEFT JOIN tallac_territories t ON o.territory_id = t.id
      LEFT JOIN tallac_contacts c ON o.primary_contact_id = c.id
      LEFT JOIN users u ON o.organization_owner_id = u.id
      WHERE o.id = $1
    `, [id]);

    if (orgResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Organization not found' 
      });
    }

    const organization = orgResult.rows[0];

    // Get social profiles
    const socialResult = await pool.query(`
      SELECT id, platform, profile_url
      FROM tallac_organization_social_profiles
      WHERE organization_id = $1
      ORDER BY created_at
    `, [id]);

    // Get associated contacts
    const contactsResult = await pool.query(`
      SELECT 
        c.id,
        c.full_name,
        c.first_name,
        c.last_name,
        c.job_title,
        c.email,
        c.phone,
        c.mobile,
        oc.is_primary,
        oc.sequence
      FROM tallac_organization_contacts oc
      JOIN tallac_contacts c ON oc.contact_id = c.id
      WHERE oc.organization_id = $1
      ORDER BY oc.is_primary DESC, oc.sequence ASC, c.full_name ASC
    `, [id]);

    // Get related prospects
    const prospectsResult = await pool.query(`
      SELECT 
        id,
        name,
        status,
        created_at
      FROM tallac_leads
      WHERE organization_id = $1
      ORDER BY created_at DESC
      LIMIT 10
    `, [id]);

    res.json({
      success: true,
      data: {
        ...organization,
        social_profiles: socialResult.rows,
        associated_contacts: contactsResult.rows,
        related_prospects: prospectsResult.rows
      }
    });
  } catch (error) {
    console.error('Error fetching organization:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

/**
 * POST /api/organizations
 * Create a new organization
 * Matches: tallac.api.prospects.create_organization
 */
router.post('/', authenticateToken, async (req: AuthRequest, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const {
      organization_name,
      doing_business_as,
      industry,
      organization_type,
      status = 'Active',
      address_line_1,
      address_line_2,
      zip_code,
      city,
      state,
      territory_id,
      truck_count,
      driver_count,
      employee_size,
      revenue,
      founded_date,
      website,
      main_phone,
      email,
      overview,
      social_profiles = [],
      primary_contact_id
    } = req.body;

    // Validate required fields
    if (!organization_name || !organization_name.trim()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false,
        error: 'Organization name is required' 
      });
    }

    // Check for duplicate organization name
    const duplicateCheck = await client.query(
      'SELECT id FROM tallac_organizations WHERE LOWER(organization_name) = LOWER($1)',
      [organization_name.trim()]
    );

    if (duplicateCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false,
        error: 'An organization with this name already exists',
        existing_id: duplicateCheck.rows[0].id
      });
    }

    // Create organization
    const orgResult = await client.query(`
      INSERT INTO tallac_organizations (
        organization_name,
        doing_business_as,
        industry,
        organization_type,
        status,
        address_line_1,
        address_line_2,
        zip_code,
        city,
        state,
        territory_id,
        truck_count,
        driver_count,
        employee_size,
        revenue,
        founded_date,
        website,
        main_phone,
        email,
        overview,
        primary_contact_id,
        organization_owner_id,
        created_by_id,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `, [
      organization_name.trim(),
      doing_business_as || null,
      industry || null,
      organization_type || null,
      status,
      address_line_1 || null,
      address_line_2 || null,
      zip_code || null,
      city || null,
      state || null,
      territory_id || null,
      truck_count || null,
      driver_count || null,
      employee_size || null,
      revenue || null,
      founded_date || null,
      website || null,
      main_phone || null,
      email || null,
      overview || null,
      primary_contact_id || null,
      req.user?.userId || null,
      req.user?.userId || null
    ]);

    const organization = orgResult.rows[0];

    // Add social profiles if provided
    if (Array.isArray(social_profiles) && social_profiles.length > 0) {
      for (const profile of social_profiles) {
        if (profile.platform && profile.profile_url) {
          await client.query(`
            INSERT INTO tallac_organization_social_profiles (
              organization_id,
              platform,
              profile_url
            ) VALUES ($1, $2, $3)
            ON CONFLICT (organization_id, platform, profile_url) DO NOTHING
          `, [organization.id, profile.platform, profile.profile_url]);
        }
      }
    }

    // If website is provided and not in social profiles, add it
    if (website && !social_profiles.some((p: any) => p.platform === 'Website')) {
      await client.query(`
        INSERT INTO tallac_organization_social_profiles (
          organization_id,
          platform,
          profile_url
        ) VALUES ($1, $2, $3)
        ON CONFLICT (organization_id, platform, profile_url) DO NOTHING
      `, [organization.id, 'Website', website]);
    }

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      data: organization,
      message: 'Organization created successfully'
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error creating organization:', error);
    
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ 
        success: false,
        error: 'Organization with this name already exists' 
      });
    }
    
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/organizations/:id
 * Update an existing organization
 * Matches: frappe.get_doc().save()
 */
router.put('/:id', authenticateToken, async (req: AuthRequest, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const {
      organization_name,
      doing_business_as,
      industry,
      organization_type,
      status,
      address_line_1,
      address_line_2,
      zip_code,
      city,
      state,
      territory_id,
      truck_count,
      driver_count,
      employee_size,
      revenue,
      founded_date,
      website,
      main_phone,
      email,
      overview,
      social_profiles,
      primary_contact_id
    } = req.body;

    // Check if organization exists
    const existingOrg = await client.query(
      'SELECT id FROM tallac_organizations WHERE id = $1',
      [id]
    );

    if (existingOrg.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ 
        success: false,
        error: 'Organization not found' 
      });
    }

    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (organization_name !== undefined) {
      updates.push(`organization_name = $${paramCount}`);
      values.push(organization_name);
      paramCount++;
    }
    if (doing_business_as !== undefined) {
      updates.push(`doing_business_as = $${paramCount}`);
      values.push(doing_business_as);
      paramCount++;
    }
    if (industry !== undefined) {
      updates.push(`industry = $${paramCount}`);
      values.push(industry);
      paramCount++;
    }
    if (organization_type !== undefined) {
      updates.push(`organization_type = $${paramCount}`);
      values.push(organization_type);
      paramCount++;
    }
    if (status !== undefined) {
      updates.push(`status = $${paramCount}`);
      values.push(status);
      paramCount++;
    }
    if (address_line_1 !== undefined) {
      updates.push(`address_line_1 = $${paramCount}`);
      values.push(address_line_1);
      paramCount++;
    }
    if (address_line_2 !== undefined) {
      updates.push(`address_line_2 = $${paramCount}`);
      values.push(address_line_2);
      paramCount++;
    }
    if (zip_code !== undefined) {
      updates.push(`zip_code = $${paramCount}`);
      values.push(zip_code);
      paramCount++;
    }
    if (city !== undefined) {
      updates.push(`city = $${paramCount}`);
      values.push(city);
      paramCount++;
    }
    if (state !== undefined) {
      updates.push(`state = $${paramCount}`);
      values.push(state);
      paramCount++;
    }
    if (territory_id !== undefined) {
      updates.push(`territory_id = $${paramCount}`);
      values.push(territory_id);
      paramCount++;
    }
    if (truck_count !== undefined) {
      updates.push(`truck_count = $${paramCount}`);
      values.push(truck_count);
      paramCount++;
    }
    if (driver_count !== undefined) {
      updates.push(`driver_count = $${paramCount}`);
      values.push(driver_count);
      paramCount++;
    }
    if (employee_size !== undefined) {
      updates.push(`employee_size = $${paramCount}`);
      values.push(employee_size);
      paramCount++;
    }
    if (revenue !== undefined) {
      updates.push(`revenue = $${paramCount}`);
      values.push(revenue);
      paramCount++;
    }
    if (founded_date !== undefined) {
      updates.push(`founded_date = $${paramCount}`);
      values.push(founded_date);
      paramCount++;
    }
    if (website !== undefined) {
      updates.push(`website = $${paramCount}`);
      values.push(website);
      paramCount++;
    }
    if (main_phone !== undefined) {
      updates.push(`main_phone = $${paramCount}`);
      values.push(main_phone);
      paramCount++;
    }
    if (email !== undefined) {
      updates.push(`email = $${paramCount}`);
      values.push(email);
      paramCount++;
    }
    if (overview !== undefined) {
      updates.push(`overview = $${paramCount}`);
      values.push(overview);
      paramCount++;
    }
    if (primary_contact_id !== undefined) {
      updates.push(`primary_contact_id = $${paramCount}`);
      values.push(primary_contact_id);
      paramCount++;
    }

    // Always update modified info
    updates.push(`modified_by_id = $${paramCount}`);
    values.push(req.user?.userId);
    paramCount++;

    updates.push(`updated_at = CURRENT_TIMESTAMP`);

    values.push(id); // For WHERE clause

    const updateQuery = `
      UPDATE tallac_organizations 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await client.query(updateQuery, values);

    // Update social profiles if provided
    if (Array.isArray(social_profiles)) {
      // Delete existing social profiles
      await client.query(
        'DELETE FROM tallac_organization_social_profiles WHERE organization_id = $1',
        [id]
      );

      // Insert new social profiles
      for (const profile of social_profiles) {
        if (profile.platform && profile.profile_url) {
          await client.query(`
            INSERT INTO tallac_organization_social_profiles (
              organization_id,
              platform,
              profile_url
            ) VALUES ($1, $2, $3)
          `, [id, profile.platform, profile.profile_url]);
        }
      }
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      data: result.rows[0],
      message: 'Organization updated successfully'
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error updating organization:', error);
    
    if (error.code === '23505') {
      return res.status(400).json({ 
        success: false,
        error: 'Organization with this name already exists' 
      });
    }
    
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/organizations/:id
 * Delete an organization
 * Only Corporate Admin can delete
 */
router.delete('/:id', authenticateToken, requireRole('Corporate Admin'), async (req: AuthRequest, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const { id } = req.params;

    // Check if organization has prospects
    const prospectsCheck = await client.query(
      'SELECT COUNT(*) as count FROM tallac_leads WHERE organization_id = $1',
      [id]
    );

    if (parseInt(prospectsCheck.rows[0].count) > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false,
        error: 'Cannot delete organization with existing prospects. Delete prospects first.' 
      });
    }

    // Delete organization (cascade will handle social profiles and contacts)
    const result = await client.query(
      'DELETE FROM tallac_organizations WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ 
        success: false,
        error: 'Organization not found' 
      });
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Organization deleted successfully'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting organization:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  } finally {
    client.release();
  }
});

/**
 * POST /api/organizations/:id/contacts
 * Add a contact to an organization
 * Matches: tallac.api.prospects.create_primary_contact
 */
router.post('/:id/contacts', authenticateToken, async (req: AuthRequest, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const { contact_id, is_primary = false } = req.body;

    if (!contact_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false,
        error: 'Contact ID is required' 
      });
    }

    // Check if organization exists
    const orgCheck = await client.query(
      'SELECT id FROM tallac_organizations WHERE id = $1',
      [id]
    );

    if (orgCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ 
        success: false,
        error: 'Organization not found' 
      });
    }

    // Check if contact exists
    const contactCheck = await client.query(
      'SELECT id FROM tallac_contacts WHERE id = $1',
      [contact_id]
    );

    if (contactCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ 
        success: false,
        error: 'Contact not found' 
      });
    }

    // If setting as primary, unset other primary contacts
    if (is_primary) {
      await client.query(
        'UPDATE tallac_organization_contacts SET is_primary = false WHERE organization_id = $1',
        [id]
      );
      
      // Also update organization's primary_contact_id
      await client.query(
        'UPDATE tallac_organizations SET primary_contact_id = $1 WHERE id = $2',
        [contact_id, id]
      );
    }

    // Add contact to organization
    await client.query(`
      INSERT INTO tallac_organization_contacts (
        organization_id,
        contact_id,
        is_primary
      ) VALUES ($1, $2, $3)
      ON CONFLICT (organization_id, contact_id) 
      DO UPDATE SET is_primary = EXCLUDED.is_primary
    `, [id, contact_id, is_primary]);

    // Also update contact's organization_id if not set
    await client.query(
      'UPDATE tallac_contacts SET organization_id = $1 WHERE id = $2 AND organization_id IS NULL',
      [id, contact_id]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Contact added to organization successfully'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error adding contact to organization:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/organizations/:id/contacts/:contactId
 * Remove a contact from an organization
 */
router.delete('/:id/contacts/:contactId', authenticateToken, async (req: AuthRequest, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const { id, contactId } = req.params;

    // Remove contact from organization
    const result = await client.query(
      'DELETE FROM tallac_organization_contacts WHERE organization_id = $1 AND contact_id = $2 RETURNING *',
      [id, contactId]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ 
        success: false,
        error: 'Contact association not found' 
      });
    }

    // If it was primary contact, clear primary_contact_id in organization
    if (result.rows[0].is_primary) {
      await client.query(
        'UPDATE tallac_organizations SET primary_contact_id = NULL WHERE id = $1',
        [id]
      );
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Contact removed from organization successfully'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error removing contact from organization:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  } finally {
    client.release();
  }
});

/**
 * GET /api/organizations/search/by-name
 * Search organizations by name - for autocomplete/typeahead
 * Matches: frappe.db.get_value('Tallac Organization', {'organization_name': name})
 */
router.get('/search/by-name', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { q, limit = 10 } = req.query;

    if (!q || typeof q !== 'string') {
      return res.status(400).json({ 
        success: false,
        error: 'Search query is required' 
      });
    }

    const result = await pool.query(`
      SELECT 
        id,
        organization_name,
        city,
        state,
        status,
        industry
      FROM tallac_organizations
      WHERE organization_name ILIKE $1 OR doing_business_as ILIKE $1
      ORDER BY organization_name ASC
      LIMIT $2
    `, [`%${q}%`, parseInt(limit as string)]);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error searching organizations:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

export default router;

