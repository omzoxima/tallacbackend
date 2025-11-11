import express from 'express';
import { pool } from '../config/database';

const router = express.Router();

// Get pipeline counts
router.get('/pipeline-counts', async (req, res) => {
  try {
    const { territory } = req.query;
    
    let query = `
      SELECT 
        status,
        COUNT(*) as count
      FROM tallac_leads
      WHERE 1=1
    `;
    const params: any[] = [];
    
    if (territory) {
      query += ` AND territory_id = (SELECT id FROM tallac_territories WHERE territory_name = $1)`;
      params.push(territory);
    }
    
    query += ` GROUP BY status ORDER BY 
      CASE status
        WHEN 'New' THEN 1
        WHEN 'Contacted' THEN 2
        WHEN 'Interested' THEN 3
        WHEN 'Qualified' THEN 4
        WHEN 'Proposal' THEN 5
        WHEN 'Negotiation' THEN 6
        WHEN 'Closed Won' THEN 7
        WHEN 'Closed Lost' THEN 8
        ELSE 9
      END`;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching pipeline counts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get leads by status
router.get('/', async (req, res) => {
  try {
    const {
      status_filter,
      territory,
      industry,
      owner,
      search_text,
      limit = 1000,
      start = 0,
    } = req.query;

    let query = `
      SELECT 
        l.*,
        u1.full_name as assigned_to_name,
        u2.full_name as lead_owner_name,
        t.territory_name,
        t.territory_name as territory,
        o.organization_name,
        c.full_name as primary_contact_full_name,
        c.job_title as primary_contact_designation,
        l.primary_contact_name as lead_name,
        l.primary_title as title,
        l.primary_email as email_id,
        l.primary_phone as phone,
        u2.full_name as lead_owner,
        CASE 
          WHEN l.callback_date < CURRENT_DATE THEN 'overdue'
          WHEN l.callback_date = CURRENT_DATE THEN 'today'
          WHEN l.callback_date > CURRENT_DATE THEN 'scheduled'
          ELSE 'none'
        END as queue_status,
        CASE 
          WHEN l.callback_date < CURRENT_DATE THEN 'Overdue: Action required'
          WHEN l.callback_date = CURRENT_DATE THEN 'Due Today: Action required'
          WHEN l.callback_date > CURRENT_DATE THEN 'Scheduled: ' || l.callback_date::text
          ELSE NULL
        END as queue_message
      FROM tallac_leads l
      LEFT JOIN users u1 ON l.assigned_to_id = u1.id
      LEFT JOIN users u2 ON l.lead_owner_id = u2.id
      LEFT JOIN tallac_territories t ON l.territory_id = t.id
      LEFT JOIN tallac_organizations o ON l.organization_id = o.id
      LEFT JOIN tallac_contacts c ON l.primary_contact_id = c.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramCount = 0;

    // Status filter - handle lowercase status values
    if (status_filter && status_filter !== 'all' && status_filter !== 'queue' && status_filter !== 'scheduled') {
      paramCount++;
      // Map lowercase to proper case
      const statusMap: Record<string, string> = {
        'new': 'New',
        'contacted': 'Contacted',
        'interested': 'Interested',
        'proposal': 'Proposal',
        'won': 'Closed Won',
        'lost': 'Closed Lost',
      };
      const dbStatus = statusMap[status_filter.toString().toLowerCase()] || status_filter.toString();
      query += ` AND LOWER(l.status) = LOWER($${paramCount})`;
      params.push(dbStatus);
    }

    // Queue status filter
    if (status_filter === 'queue') {
      query += ` AND (l.queue_status = 'overdue' OR l.queue_status = 'today')`;
    } else if (status_filter === 'scheduled') {
      query += ` AND l.queue_status = 'scheduled'`;
    }

    // Territory filter
    if (territory && territory !== 'all') {
      paramCount++;
      query += ` AND l.territory_id = (SELECT id FROM tallac_territories WHERE territory_name = $${paramCount})`;
      params.push(territory);
    }

    // Industry filter
    if (industry && industry !== 'all') {
      paramCount++;
      query += ` AND l.industry = $${paramCount}`;
      params.push(industry);
    }

    // Owner filter
    if (owner && owner !== 'all') {
      if (owner === 'Unassigned') {
        query += ` AND (l.lead_owner_id IS NULL OR u2.full_name = 'Administrator')`;
      } else {
        paramCount++;
        query += ` AND u2.full_name = $${paramCount}`;
        params.push(owner);
      }
    }

    // Search filter
    if (search_text) {
      paramCount++;
      query += ` AND (l.company_name ILIKE $${paramCount} OR l.primary_contact_name ILIKE $${paramCount} OR l.primary_email ILIKE $${paramCount})`;
      params.push(`%${search_text}%`);
    }

    query += ` ORDER BY l.updated_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(parseInt(limit as string), parseInt(start as string));

    const result = await pool.query(query, params);

    // Get contact paths for each lead
    for (const lead of result.rows) {
      const contactPathQuery = `
        SELECT 
          cp.contact_name,
          cp.status,
          cp.sequence
        FROM tallac_lead_contact_paths cp
        WHERE cp.lead_id = $1
        ORDER BY cp.sequence ASC
      `;
      const contactPathResult = await pool.query(contactPathQuery, [lead.id]);
      lead.contact_path = contactPathResult.rows;
    }

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching leads:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single lead
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT 
        l.*,
        u1.full_name as assigned_to_name,
        u2.full_name as lead_owner_name,
        t.territory_name,
        o.organization_name,
        c.full_name as primary_contact_full_name,
        c.job_title as primary_contact_designation
      FROM tallac_leads l
      LEFT JOIN users u1 ON l.assigned_to_id = u1.id
      LEFT JOIN users u2 ON l.lead_owner_id = u2.id
      LEFT JOIN tallac_territories t ON l.territory_id = t.id
      LEFT JOIN tallac_organizations o ON l.organization_id = o.id
      LEFT JOIN tallac_contacts c ON l.primary_contact_id = c.id
      WHERE l.id = $1 OR l.name = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    
    const lead = result.rows[0];
    
    // Get contact paths
    const contactPathQuery = `
      SELECT 
        cp.contact_name,
        cp.status,
        cp.sequence
      FROM tallac_lead_contact_paths cp
      WHERE cp.lead_id = $1
      ORDER BY cp.sequence ASC
    `;
    const contactPathResult = await pool.query(contactPathQuery, [lead.id]);
    lead.contact_path = contactPathResult.rows;
    
    res.json(lead);
  } catch (error) {
    console.error('Error fetching lead:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create lead
router.post('/', async (req, res) => {
  try {
    const leadData = req.body;
    
    // Generate name (TLEAD-00001 format)
    const nameQuery = await pool.query(
      'SELECT COUNT(*) as count FROM tallac_leads'
    );
    const count = parseInt(nameQuery.rows[0].count) + 1;
    const name = `TLEAD-${String(count).padStart(5, '0')}`;
    
    const insertQuery = `
      INSERT INTO tallac_leads (
        name, company_name, industry, status, organization_id,
        territory_id, primary_contact_name, primary_title,
        primary_phone, primary_email, city, state, zip_code
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `;
    
    const result = await pool.query(insertQuery, [
      name,
      leadData.company_name,
      leadData.industry || null,
      leadData.status || 'New',
      leadData.organization_id || null,
      leadData.territory_id || null,
      leadData.primary_contact_name || null,
      leadData.primary_title || null,
      leadData.primary_phone || null,
      leadData.primary_email || null,
      leadData.city || null,
      leadData.state || null,
      leadData.zip_code || null,
    ]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating lead:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update lead
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const leadData = req.body;
    
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramCount = 0;
    
    Object.keys(leadData).forEach((key) => {
      if (key !== 'id' && key !== 'name' && key !== 'created_at') {
        paramCount++;
        updateFields.push(`${key} = $${paramCount}`);
        values.push(leadData[key]);
      }
    });
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    paramCount++;
    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);
    
    const query = `
      UPDATE tallac_leads
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount} OR name = $${paramCount}
      RETURNING *
    `;
    
    const result = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating lead:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Assign lead
router.post('/:id/assign', async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.body;
    
    const query = `
      UPDATE tallac_leads
      SET assigned_to_id = $1, assigned_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 OR name = $2
      RETURNING *
    `;
    
    const result = await pool.query(query, [user_id, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    
    res.json({ success: true, message: 'Lead assigned successfully', lead: result.rows[0] });
  } catch (error) {
    console.error('Error assigning lead:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete lead
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = 'DELETE FROM tallac_leads WHERE id = $1 OR name = $1 RETURNING *';
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    
    res.json({ success: true, message: 'Lead deleted successfully' });
  } catch (error) {
    console.error('Error deleting lead:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk assign leads
router.post('/bulk/assign', async (req, res) => {
  try {
    const { lead_names, user_id } = req.body;
    
    if (!Array.isArray(lead_names) || lead_names.length === 0) {
      return res.status(400).json({ error: 'lead_names array is required' });
    }
    
    // Get user ID if user_id is an email
    let assignedToId = user_id;
    if (typeof user_id === 'string' && user_id.includes('@')) {
      const userQuery = await pool.query('SELECT id FROM users WHERE email = $1', [user_id]);
      if (userQuery.rows.length > 0) {
        assignedToId = userQuery.rows[0].id;
      } else {
        return res.status(404).json({ error: 'User not found' });
      }
    }
    
    // Update all leads
    const placeholders = lead_names.map((_, i) => `$${i + 2}`).join(', ');
    const query = `
      UPDATE tallac_leads
      SET assigned_to_id = $1, assigned_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP
      WHERE name = ANY(ARRAY[${placeholders}])
      RETURNING name, company_name
    `;
    
    const result = await pool.query(query, [assignedToId, ...lead_names]);
    
    res.json({ 
      success: true, 
      message: `Assigned ${result.rows.length} leads successfully`,
      count: result.rows.length 
    });
  } catch (error) {
    console.error('Error bulk assigning leads:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk update status
router.post('/bulk/status', async (req, res) => {
  try {
    const { lead_names, status } = req.body;
    
    if (!Array.isArray(lead_names) || lead_names.length === 0) {
      return res.status(400).json({ error: 'lead_names array is required' });
    }
    
    if (!status) {
      return res.status(400).json({ error: 'status is required' });
    }
    
    // Map lowercase status to proper case
    const statusMap: Record<string, string> = {
      'new': 'New',
      'contacted': 'Contacted',
      'interested': 'Interested',
      'proposal': 'Proposal',
      'won': 'Closed Won',
      'lost': 'Closed Lost',
    };
    const dbStatus = statusMap[status.toLowerCase()] || status;
    
    // Update all leads
    const placeholders = lead_names.map((_, i) => `$${i + 2}`).join(', ');
    const query = `
      UPDATE tallac_leads
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE name = ANY(ARRAY[${placeholders}])
      RETURNING name, company_name, status
    `;
    
    const result = await pool.query(query, [dbStatus, ...lead_names]);
    
    res.json({ 
      success: true, 
      message: `Updated ${result.rows.length} leads to ${dbStatus}`,
      count: result.rows.length 
    });
  } catch (error) {
    console.error('Error bulk updating status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk delete leads
router.post('/bulk/delete', async (req, res) => {
  try {
    const { lead_names } = req.body;
    
    if (!Array.isArray(lead_names) || lead_names.length === 0) {
      return res.status(400).json({ error: 'lead_names array is required' });
    }
    
    // Delete all leads
    const placeholders = lead_names.map((_, i) => `$${i + 1}`).join(', ');
    const query = `
      DELETE FROM tallac_leads
      WHERE name = ANY(ARRAY[${placeholders}])
      RETURNING name, company_name
    `;
    
    const result = await pool.query(query, lead_names);
    
    res.json({ 
      success: true, 
      message: `Deleted ${result.rows.length} leads successfully`,
      count: result.rows.length 
    });
  } catch (error) {
    console.error('Error bulk deleting leads:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

