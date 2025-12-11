import express from 'express';
import { pool } from '../config/database';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Get all contacts - from tallac_contacts with organization info
// Allow without auth for search functionality
router.get('/', async (req, res) => {
  try {
    const { search, limit = 1000, organization_id } = req.query;

    // Get contacts with organization info
    let query = `
      SELECT 
        c.id,
        c.full_name,
        c.full_name as name,
        c.first_name,
        c.last_name,
        c.email,
        c.email as email_id,
        COALESCE(c.mobile, c.phone) as mobile_no,
        COALESCE(c.mobile, c.phone) as phone,
        c.job_title as designation,
        c.job_title as title,
        c.organization_id,
        o.organization_name,
        c.created_at,
        c.updated_at
      FROM tallac_contacts c
      LEFT JOIN tallac_organizations o ON c.organization_id = o.id
      WHERE c.full_name IS NOT NULL
    `;
    const params: any[] = [];
    let paramCount = 1;

    // Filter by organization
    if (organization_id && typeof organization_id === 'string') {
      query += ` AND c.organization_id = $${paramCount}`;
      params.push(organization_id);
      paramCount++;
    }

    // Search filter
    if (search) {
      query += ` AND (
        c.full_name ILIKE $${paramCount} 
        OR c.email ILIKE $${paramCount}
        OR c.job_title ILIKE $${paramCount}
      )`;
      params.push(`%${search}%`);
      paramCount++;
    }

    query += ` ORDER BY c.full_name LIMIT $${paramCount}`;
    params.push(parseInt(limit as string));

    const result = await pool.query(query, params);
    
    // Map database fields to API response format
    const mappedRows = result.rows.map(row => ({
      id: row.id,
      full_name: row.full_name,
      name: row.full_name,
      first_name: row.first_name,
      last_name: row.last_name,
      email_id: row.email,
      email: row.email,
      mobile_no: row.mobile_no,
      phone: row.phone,
      designation: row.designation,
      title: row.designation,
      organization_id: row.organization_id,
      organization_name: row.organization_name,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
    
    res.json(mappedRows);
  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new contact
router.post('/', authenticateToken, async (req: AuthRequest, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { full_name, first_name, last_name, designation, phones, emails, preferred_call_time, organization_id, partner_id, lead_id } = req.body;

    if (!full_name || full_name.trim() === '') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Full name is required' });
    }

    // Parse first and last name from full_name if not provided
    let firstName = first_name;
    let lastName = last_name;
    if (!firstName && !lastName && full_name) {
      const nameParts = full_name.trim().split(' ');
      firstName = nameParts[0];
      lastName = nameParts.slice(1).join(' ');
    }

    // Get primary phone and email
    const primaryPhone = phones?.find((p: any) => p.is_primary_phone === 1)?.phone || phones?.[0]?.phone || null;
    const primaryEmail = emails?.find((e: any) => e.is_primary === 1)?.email_id || emails?.[0]?.email_id || null;

    // Insert into tallac_contacts
    const insertQuery = `
      INSERT INTO tallac_contacts (
        full_name, first_name, last_name, job_title, email, phone, mobile, 
        preferred_call_time, is_primary, organization_id, partner_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `;

    const result = await client.query(insertQuery, [
      full_name,
      firstName || null,
      lastName || null,
      designation || null,
      primaryEmail,
      primaryPhone,
      primaryPhone, // mobile same as phone for now
      preferred_call_time || null,
      true, // is_primary
      organization_id || null,
      partner_id || null,
    ]);

    const contactId = result.rows[0].id;

    // Link to organization if organization_id provided
    if (organization_id) {
      await client.query(`
        INSERT INTO tallac_organization_contacts (
          organization_id, contact_id, is_primary, sequence
        ) VALUES ($1, $2, $3, 
          (SELECT COALESCE(MAX(sequence), 0) + 1 FROM tallac_organization_contacts WHERE organization_id = $1)
        )
        ON CONFLICT (organization_id, contact_id) DO NOTHING
      `, [organization_id, contactId, false]);
    }

    // Link to lead if lead_id provided
    if (lead_id) {
      const linkQuery = `
        INSERT INTO tallac_lead_contacts (
          lead_id, contact_id, contact_name, title, email, phone, mobile, sequence
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 
          (SELECT COALESCE(MAX(sequence), 0) + 1 FROM tallac_lead_contacts WHERE lead_id = $1)
        )
      `;
      await client.query(linkQuery, [
        lead_id,
        contactId,
        full_name,
        designation || null,
        primaryEmail,
        primaryPhone,
        primaryPhone,
      ]);
    }

    await client.query('COMMIT');

    res.json({ success: true, contact: result.rows[0] });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error creating contact:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Update contact
router.put('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { full_name, first_name, last_name, designation, phones, emails, preferred_call_time, organization_id, partner_id } = req.body;

    if (!full_name || full_name.trim() === '') {
      return res.status(400).json({ error: 'Full name is required' });
    }

    // Parse first and last name from full_name if not provided
    let firstName = first_name;
    let lastName = last_name;
    if (!firstName && !lastName && full_name) {
      const nameParts = full_name.trim().split(' ');
      firstName = nameParts[0];
      lastName = nameParts.slice(1).join(' ');
    }

    // Get primary phone and email
    const primaryPhone = phones?.find((p: any) => p.is_primary_phone === 1)?.phone || phones?.[0]?.phone || null;
    const primaryEmail = emails?.find((e: any) => e.is_primary === 1)?.email_id || emails?.[0]?.email_id || null;

    // Update tallac_contacts
    const updateQuery = `
      UPDATE tallac_contacts
      SET 
        full_name = $1,
        first_name = $2,
        last_name = $3,
        job_title = $4,
        email = $5,
        phone = $6,
        mobile = $7,
        preferred_call_time = $8,
        organization_id = $9,
        partner_id = $10,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $11
      RETURNING *
    `;

    const result = await pool.query(updateQuery, [
      full_name,
      firstName || null,
      lastName || null,
      designation || null,
      primaryEmail,
      primaryPhone,
      primaryPhone,
      preferred_call_time || null,
      organization_id || null,
      partner_id || null,
      id,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    res.json({ success: true, contact: result.rows[0] });
  } catch (error: any) {
    console.error('Error updating contact:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get contact by ID with organization details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      SELECT 
        c.*,
        o.organization_name,
        o.industry,
        o.city as org_city,
        o.state as org_state
      FROM tallac_contacts c
      LEFT JOIN tallac_organizations o ON c.organization_id = o.id
      WHERE c.id = $1
    `;

    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    res.json({ success: true, contact: result.rows[0] });
  } catch (error) {
    console.error('Error fetching contact:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

