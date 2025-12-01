import express from 'express';
import { pool } from '../config/database';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Get all contacts - from tallac_contacts only
// Allow without auth for search functionality
router.get('/', async (req, res) => {
  try {
    const { search, limit = 1000 } = req.query;

    // Get contacts only from tallac_contacts table
    // Schema: email, mobile, phone, job_title
    let query = `
      SELECT 
        c.id,
        c.full_name,
        c.full_name as name,
        c.email,
        c.email as email_id,
        COALESCE(c.mobile, c.phone) as mobile_no,
        COALESCE(c.mobile, c.phone) as phone,
        c.job_title as designation,
        c.job_title as title
      FROM tallac_contacts c
      WHERE c.full_name IS NOT NULL
    `;
    const params: any[] = [];
    let paramCount = 1;

    if (search) {
      query += ` AND (
        c.full_name ILIKE $${paramCount} 
        OR c.email ILIKE $${paramCount}
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
      email_id: row.email,
      email: row.email,
      mobile_no: row.mobile_no,
      phone: row.phone,
      designation: row.designation,
      title: row.designation,
    }));
    
    res.json(mappedRows);
  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new contact
router.post('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { full_name, designation, phones, emails, preferred_call_time, organization_id, lead_id } = req.body;

    if (!full_name || full_name.trim() === '') {
      return res.status(400).json({ error: 'Full name is required' });
    }

    // Get primary phone and email
    const primaryPhone = phones?.find((p: any) => p.is_primary_phone === 1)?.phone || phones?.[0]?.phone || null;
    const primaryEmail = emails?.find((e: any) => e.is_primary === 1)?.email_id || emails?.[0]?.email_id || null;

    // Insert into tallac_contacts
    const insertQuery = `
      INSERT INTO tallac_contacts (
        full_name, job_title, email, phone, mobile, preferred_call_time, is_primary
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    const result = await pool.query(insertQuery, [
      full_name,
      designation || null,
      primaryEmail,
      primaryPhone,
      primaryPhone, // mobile same as phone for now
      preferred_call_time || null,
      true, // is_primary
    ]);

    const contactId = result.rows[0].id;

    // Link to lead if lead_id provided
    if (lead_id) {
      const linkQuery = `
        INSERT INTO tallac_lead_contacts (
          lead_id, contact_id, contact_name, title, email, phone, mobile, sequence
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 
          (SELECT COALESCE(MAX(sequence), 0) + 1 FROM tallac_lead_contacts WHERE lead_id = $1)
        )
      `;
      await pool.query(linkQuery, [
        lead_id,
        contactId,
        full_name,
        designation || null,
        primaryEmail,
        primaryPhone,
        primaryPhone,
      ]);
    }

    res.json({ success: true, contact: result.rows[0] });
  } catch (error: any) {
    console.error('Error creating contact:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update contact
router.put('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { full_name, designation, phones, emails, preferred_call_time } = req.body;

    if (!full_name || full_name.trim() === '') {
      return res.status(400).json({ error: 'Full name is required' });
    }

    // Get primary phone and email
    const primaryPhone = phones?.find((p: any) => p.is_primary_phone === 1)?.phone || phones?.[0]?.phone || null;
    const primaryEmail = emails?.find((e: any) => e.is_primary === 1)?.email_id || emails?.[0]?.email_id || null;

    // Update tallac_contacts
    const updateQuery = `
      UPDATE tallac_contacts
      SET 
        full_name = $1,
        job_title = $2,
        email = $3,
        phone = $4,
        mobile = $5,
        preferred_call_time = $6,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $7
      RETURNING *
    `;

    const result = await pool.query(updateQuery, [
      full_name,
      designation || null,
      primaryEmail,
      primaryPhone,
      primaryPhone,
      preferred_call_time || null,
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

export default router;

