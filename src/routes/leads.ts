import express from 'express';
import { pool } from '../config/database';

const router = express.Router();

// Get simple status summary for fast pipeline counts on Prospects page
router.get('/summary', async (req, res) => {
  try {
    const summaryQuery = `
      SELECT LOWER(status) as status, COUNT(*)::int as count
      FROM tallac_leads
      GROUP BY LOWER(status)
    `;
    const result = await pool.query(summaryQuery);

    const counts: Record<string, number> = {
      new: 0,
      contacted: 0,
      interested: 0,
      proposal: 0,
      won: 0,
      lost: 0,
    };

    result.rows.forEach((row) => {
      const rawStatus = (row.status || '').toLowerCase();
      let mapped = rawStatus;
      if (rawStatus === 'closed won') mapped = 'won';
      else if (rawStatus === 'closed lost') mapped = 'lost';

      if (mapped in counts) {
        counts[mapped] += row.count || 0;
      }
    });

    return res.json(counts);
  } catch (error) {
    console.error('Error fetching lead summary:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

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
        l.id,
        l.name,
        l.organization_id,
        l.company_name,
        l.industry,
        l.status,
        l.lead_owner_id,
        l.assigned_to_id,
        l.primary_contact_id,
        l.primary_contact_name,
        l.primary_title,
        l.primary_phone,
        l.primary_email,
        l.zip_code,
        l.city,
        l.state,
        l.territory_id,
        l.created_at,
        l.updated_at,
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

    // Get contacts for all leads using tallac_lead_contacts (simple lookup)
    if (result.rows.length > 0) {
      const leadIds = result.rows.map((lead) => lead.id);
      const contactsQuery = `
        SELECT 
          lc.lead_id,
          c.id,
          c.full_name as name,
          c.email,
          COALESCE(c.mobile, c.phone) as phone,
          c.job_title as designation,
          lc.sequence,
          lc.contact_id
        FROM tallac_lead_contacts lc
        LEFT JOIN tallac_contacts c ON lc.contact_id = c.id
        WHERE lc.lead_id = ANY($1)
        ORDER BY lc.lead_id, lc.sequence ASC
      `;
      const contactsResult = await pool.query(contactsQuery, [leadIds]);
      
      // Group contacts by lead_id
      const contactsByLeadId: Record<string, any[]> = {};
      contactsResult.rows.forEach((contact) => {
        if (!contactsByLeadId[contact.lead_id]) {
          contactsByLeadId[contact.lead_id] = [];
        }
        contactsByLeadId[contact.lead_id].push({
          id: contact.contact_id,
          name: contact.name,
          email: contact.email,
          phone: contact.phone,
          designation: contact.designation,
          sequence: contact.sequence
        });
      });
      
      // Attach contacts to leads as contact_path (for compatibility)
      result.rows.forEach((lead) => {
        lead.contact_path = contactsByLeadId[lead.id] || [];
      });
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
        l.id,
        l.name,
        l.organization_id,
        l.company_name,
        l.industry,
        l.status,
        l.lead_owner_id,
        l.assigned_to_id,
        l.primary_contact_id,
        l.primary_contact_name,
        l.primary_title,
        l.primary_phone,
        l.primary_email,
        l.zip_code,
        l.city,
        l.state,
        l.territory_id,
        l.created_at,
        l.updated_at,
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
    
    // Get contacts for this lead using tallac_lead_contacts
    const contactsQuery = `
      SELECT 
        c.id,
        c.full_name as name,
        c.email,
        COALESCE(c.mobile, c.phone) as phone,
        c.job_title as designation,
        lc.sequence,
        lc.contact_id
      FROM tallac_lead_contacts lc
      LEFT JOIN tallac_contacts c ON lc.contact_id = c.id
      WHERE lc.lead_id = $1
      ORDER BY lc.sequence ASC
    `;
    const contactsResult = await pool.query(contactsQuery, [lead.id]);
    lead.contact_path = contactsResult.rows.map(contact => ({
      id: contact.contact_id,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      designation: contact.designation,
      sequence: contact.sequence
    }));
    
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
    
    // Validate zip code is provided (mandatory only if territory is not selected)
    if (!leadData.territory_id && (!leadData.zip_code || !leadData.zip_code.trim())) {
      return res.status(400).json({ error: 'ZIP code is required when territory is not selected' });
    }
    
    // Find territory from zip code
    let territoryId = leadData.territory_id || null;
    let territoryOwnerId = null;
    
    // If territory_id is already provided, use it; otherwise try to find from zip_code
    if (leadData.territory_id) {
      territoryId = leadData.territory_id;
    } else if (leadData.zip_code && leadData.zip_code.trim()) {
      const territoryQuery = `
        SELECT tz.territory_id, t.territory_name
        FROM territory_zip_codes tz
        JOIN tallac_territories t ON tz.territory_id = t.id
        WHERE tz.zip_code = $1
        LIMIT 1
      `;
      const territoryResult = await pool.query(territoryQuery, [leadData.zip_code.trim()]);
      
      if (territoryResult.rows.length > 0) {
        territoryId = territoryResult.rows[0].territory_id;
        
        // Performance optimization: Try both owner queries in parallel
        const [ownerResult, fallbackResult] = await Promise.all([
          pool.query(`
            SELECT u.id, u.full_name, u.role, u.tallac_role
            FROM territory_owners to_owners
            JOIN users u ON to_owners.owner_name = u.full_name
            WHERE to_owners.territory_id = $1
            AND u.role NOT IN ('Sales User', 'Tallac User')
            AND (u.tallac_role IS NULL OR u.tallac_role NOT IN ('Sales User', 'Tallac User'))
            AND u.is_active = true
            LIMIT 1
          `, [territoryId]),
          pool.query(`
            SELECT u.id, u.full_name, u.role, u.tallac_role
            FROM tallac_territories t
            JOIN users u ON t.territory_owner = u.full_name
            WHERE t.id = $1
            AND u.role NOT IN ('Sales User', 'Tallac User')
            AND (u.tallac_role IS NULL OR u.tallac_role NOT IN ('Sales User', 'Tallac User'))
            AND u.is_active = true
            LIMIT 1
          `, [territoryId])
        ]);
        
        if (ownerResult.rows.length > 0) {
          territoryOwnerId = ownerResult.rows[0].id;
        } else if (fallbackResult.rows.length > 0) {
          territoryOwnerId = fallbackResult.rows[0].id;
        }
      }
    }
    
    // If territory is selected but no owner found yet, try to find owner
    if (territoryId && !territoryOwnerId) {
      const [ownerResult, fallbackResult] = await Promise.all([
        pool.query(`
          SELECT u.id, u.full_name, u.role, u.tallac_role
          FROM territory_owners to_owners
          JOIN users u ON to_owners.owner_name = u.full_name
          WHERE to_owners.territory_id = $1
          AND u.role NOT IN ('Sales User', 'Tallac User')
          AND (u.tallac_role IS NULL OR u.tallac_role NOT IN ('Sales User', 'Tallac User'))
          AND u.is_active = true
          LIMIT 1
        `, [territoryId]),
        pool.query(`
          SELECT u.id, u.full_name, u.role, u.tallac_role
          FROM tallac_territories t
          JOIN users u ON t.territory_owner = u.full_name
          WHERE t.id = $1
          AND u.role NOT IN ('Sales User', 'Tallac User')
          AND (u.tallac_role IS NULL OR u.tallac_role NOT IN ('Sales User', 'Tallac User'))
          AND u.is_active = true
          LIMIT 1
        `, [territoryId])
      ]);
      
      if (ownerResult.rows.length > 0) {
        territoryOwnerId = ownerResult.rows[0].id;
      } else if (fallbackResult.rows.length > 0) {
        territoryOwnerId = fallbackResult.rows[0].id;
      }
    }
    
    // Handle contact - get or create from tallac_contacts table
    let primaryContactId = null;
    if (leadData.selectedContact && leadData.selectedContact.id) {
      // Contact selected from dropdown - use existing contact
      primaryContactId = leadData.selectedContact.id;
    } else if (leadData.primary_contact_name || leadData.primary_email) {
      // Check if contact exists by email or name
      const existingContactQuery = `
        SELECT id FROM tallac_contacts 
        WHERE (email = $1 AND email IS NOT NULL) 
           OR (full_name = $2 AND full_name IS NOT NULL)
        LIMIT 1
      `;
      const existingContactResult = await pool.query(existingContactQuery, [
        leadData.primary_email || leadData.email,
        leadData.primary_contact_name || leadData.contact_name
      ]);
      
      if (existingContactResult.rows.length > 0) {
        primaryContactId = existingContactResult.rows[0].id;
      } else {
        // Create new contact in tallac_contacts
        const contactName = leadData.primary_contact_name || leadData.contact_name || 'Unknown';
        const contactEmail = leadData.primary_email || leadData.email || null;
        const contactPhone = leadData.primary_phone || leadData.phone || null;
        const contactMobile = leadData.primary_mobile || leadData.mobile || contactPhone;
        const contactTitle = leadData.primary_title || leadData.title || leadData.designation || null;
        
        const createContactQuery = `
          INSERT INTO tallac_contacts (
            full_name, email, phone, mobile, job_title, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING id
        `;
        const newContactResult = await pool.query(createContactQuery, [
          contactName,
          contactEmail,
          contactPhone,
          contactMobile,
          contactTitle
        ]);
        primaryContactId = newContactResult.rows[0].id;
      }
    }
    
    // Generate name (TLEAD-00001 format) - optimized using MAX instead of COUNT
    const nameQuery = await pool.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(name FROM 'TLEAD-(\\d+)') AS INTEGER)), 0) + 1 as next_num FROM tallac_leads WHERE name ~ '^TLEAD-\\d+$'`
    );
    const nextNum = parseInt(nameQuery.rows[0].next_num) || 1;
    const name = `TLEAD-${String(nextNum).padStart(5, '0')}`;
    
    // Get contact details for lead table (for backward compatibility)
    let contactName = null;
    let contactTitle = null;
    let contactPhone = null;
    let contactEmail = null;
    
    if (primaryContactId) {
      const contactDetailsQuery = await pool.query(
        'SELECT full_name, job_title, phone, mobile, email FROM tallac_contacts WHERE id = $1',
        [primaryContactId]
      );
      if (contactDetailsQuery.rows.length > 0) {
        const contact = contactDetailsQuery.rows[0];
        contactName = contact.full_name;
        contactTitle = contact.job_title;
        contactPhone = contact.phone || contact.mobile;
        contactEmail = contact.email;
      }
    }
    
    const insertQuery = `
      INSERT INTO tallac_leads (
        name, company_name, industry, status, organization_id,
        territory_id, lead_owner_id, primary_contact_id, primary_contact_name, primary_title,
        primary_phone, primary_email, city, state, zip_code, full_address
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `;
    
    // Build full address
    const addressParts = [
      leadData.address,
      leadData.city,
      leadData.state,
      leadData.zip_code
    ].filter(Boolean);
    const fullAddress = addressParts.join(', ');
    
    const result = await pool.query(insertQuery, [
      name,
      leadData.company_name || leadData.selectedCompany?.company_name,
      leadData.industry || null,
      leadData.status || 'New',
      leadData.organization_id || leadData.selectedCompany?.id || null,
      territoryId,
      territoryOwnerId, // Auto-assigned based on territory
      primaryContactId, // Contact ID from tallac_contacts
      contactName, // For backward compatibility
      contactTitle,
      contactPhone,
      contactEmail,
      leadData.city || null,
      leadData.state || null,
      leadData.zip_code || null,
      fullAddress || null,
    ]);
    
    const newLead = result.rows[0];
    
    // Link contact to lead in tallac_lead_contacts (if contact exists)
    if (primaryContactId) {
      const linkContactQuery = `
        INSERT INTO tallac_lead_contacts (
          lead_id, contact_id, sequence, created_at
        ) VALUES ($1, $2, 0, CURRENT_TIMESTAMP)
        ON CONFLICT DO NOTHING
      `;
      await pool.query(linkContactQuery, [newLead.id, primaryContactId]);
    }
    
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

