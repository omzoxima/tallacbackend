import express from 'express';
import pool from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get timeline activities for a reference document
router.get('/timeline', authenticateToken, async (req, res) => {
  try {
    const { reference_doctype, reference_docname, activity_types, limit = 100 } = req.query;
    
    if (!reference_doctype || !reference_docname) {
      return res.status(400).json({ success: false, message: 'reference_doctype and reference_docname are required' });
    }

    const types = activity_types ? JSON.parse(activity_types) : ['activity', 'call_log', 'note', 'version', 'assignment'];
    const activities = [];

    // Get Tallac Activities
    if (types.includes('activity')) {
      let filters = {};
      if (reference_doctype === 'Tallac Prospect') {
        filters.prospect_id = reference_docname;
      } else if (reference_doctype === 'Tallac Organization') {
        filters.company_id = reference_docname;
      } else if (reference_doctype === 'Contact') {
        filters.contact_id = reference_docname;
      }

      const result = await pool.query(
        `SELECT 
          ta.id, 
          COALESCE(ta.activity_code, ta.name) as activity_code,
          ta.activity_type, 
          COALESCE(ta.title, ta.subject) as subject, 
          ast.status_name as status, 
          ta.priority,
          ta.scheduled_date, ta.scheduled_time, ta.assigned_to_id, ta.created_by_id,
          ta.description, 
          COALESCE(ta.outcome_status, ta.call_outcome) as call_outcome,
          COALESCE(ta.completed_on, ta.date_time, ta.created_at) as date_time, 
          ta.created_at, ta.updated_at
         FROM tallac_activities ta
         LEFT JOIN activity_statuses ast ON ta.status_id = ast.id
         WHERE ${Object.keys(filters).map((key, i) => {
           if (key === 'prospect_id') {
             return `(ta.reference_docname = $${i + 1} OR ta.prospect_id::text = $${i + 1})`;
           } else if (key === 'company_id') {
             return `ta.organization_id = $${i + 1}`;
           } else if (key === 'contact_id') {
             return `COALESCE(ta.contact_person_id, ta.contact_id) = $${i + 1}`;
           } else {
             return `ta.${key} = $${i + 1}`;
           }
         }).join(' AND ')}
         ORDER BY ta.scheduled_date DESC, ta.scheduled_time DESC
         LIMIT $${Object.keys(filters).length + 1}`,
        [...Object.values(filters), parseInt(limit)]
      );

      for (const activity of result.rows) {
        activities.push({
          ...activity,
          timeline_type: 'activity',
          icon: activity.activity_type === 'Appointment' ? 'calendar' : 'phone',
          display_date: activity.scheduled_date || activity.created_at
        });
      }
    }

    // Sort by display_date
    activities.sort((a, b) => {
      const dateA = new Date(a.display_date || a.created_at || 0);
      const dateB = new Date(b.display_date || b.created_at || 0);
      return dateB - dateA;
    });

    res.json({
      success: true,
      data: activities.slice(0, parseInt(limit))
    });
  } catch (error) {
    console.error('Get timeline activities error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch timeline activities', error: error.message });
  }
});

// Get prospect activities
router.get('/prospect/:prospectId', authenticateToken, async (req, res) => {
  try {
    const { prospectId } = req.params;
    const { limit = 5, activity_types, exclude_scheduled = 0 } = req.query;

    let query = `
      SELECT 
        ta.id, 
        COALESCE(ta.activity_code, ta.name) as activity_code, 
        ta.activity_type, 
        COALESCE(ta.title, ta.subject) as subject, 
        ast.status_name as status, 
        ta.priority,
        COALESCE(ta.completed_on, ta.date_time, ta.created_at) as date_time, 
        ta.assigned_to_id, ta.created_by_id, 
        ta.description, 
        COALESCE(ta.outcome_status, ta.call_outcome) as call_outcome, 
        CASE 
          WHEN ta.completed_on IS NOT NULL THEN EXTRACT(EPOCH FROM (ta.completed_on - ta.created_at))::INTEGER
          ELSE ta.duration 
        END as duration,
        ta.organization_id as company_id, 
        COALESCE(ta.contact_person_id, ta.contact_id) as contact_id, 
        COALESCE(ta.reference_docname, ta.prospect_id::text) as prospect_id,
        ta.scheduled_date, ta.scheduled_time, ta.created_at, ta.updated_at
      FROM tallac_activities ta
      LEFT JOIN activity_statuses ast ON ta.status_id = ast.id
      WHERE (ta.reference_docname = $1 OR ta.prospect_id::text = $1) 
        AND (ta.reference_doctype = 'Prospect' OR ta.reference_doctype IS NULL)
    `;

    const params = [prospectId];

    if (activity_types) {
      const types = JSON.parse(activity_types);
      query += ` AND ta.activity_type = ANY($${params.length + 1})`;
      params.push(types);
    }

    if (exclude_scheduled === '1') {
      query += ` AND NOT (ta.activity_type IN ('Callback', 'Appointment') AND ast.status_name IN ('Open', 'In Progress'))`;
    }

    query += ` ORDER BY COALESCE(ta.completed_on, ta.date_time, ta.created_at) DESC NULLS LAST LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get prospect activities error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch prospect activities', error: error.message });
  }
});

// Get scheduled activities for a prospect
router.get('/prospect/:prospectId/scheduled', authenticateToken, async (req, res) => {
  try {
    const { prospectId } = req.params;

    const result = await pool.query(
      `SELECT 
        ta.id, 
        COALESCE(ta.activity_code, ta.name) as activity_code, 
        ta.activity_type, 
        COALESCE(ta.title, ta.subject) as subject, 
        ast.status_name as status, 
        ta.priority,
        ta.scheduled_date, ta.scheduled_time, ta.assigned_to_id, ta.created_by_id,
        ta.description, 
        COALESCE(ta.contact_person_id, ta.contact_id) as contact_id, 
        ta.created_at
      FROM tallac_activities ta
      LEFT JOIN activity_statuses ast ON ta.status_id = ast.id
      WHERE (ta.reference_docname = $1 OR ta.prospect_id::text = $1) 
        AND (ta.reference_doctype = 'Prospect' OR ta.reference_doctype IS NULL)
        AND ta.activity_type IN ('Callback', 'Appointment')
        AND ast.status_name IN ('Open', 'In Progress')
      ORDER BY ta.scheduled_date ASC, ta.scheduled_time ASC`,
      [prospectId]
    );

    // OPTIMIZED: Batch query all contact names at once
    const contactIds = result.rows.filter(a => a.contact_id).map(a => a.contact_id);
    const contactsResult = contactIds.length > 0 ? await pool.query(
      'SELECT id, full_name FROM contacts WHERE id = ANY($1)',
      [contactIds]
    ) : { rows: [] };
    const contactsMap = {};
    for (const contact of contactsResult.rows) {
      contactsMap[contact.id] = contact.full_name;
    }
    
    // Enrich activities with contact names
    for (const activity of result.rows) {
      activity.contact_name = activity.contact_id ? (contactsMap[activity.contact_id] || null) : null;
    }

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get scheduled activities error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch scheduled activities', error: error.message });
  }
});

// Get all activities with filters
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { 
      prospect, prospect_id, company, activity_types, status, assigned_to, 
      date_from, date_to, page = 1, page_size = 25 
    } = req.query;

    // Build base WHERE conditions (without JOINs for count query)
    const baseWhereConditions = [];
    const params = [];
    let paramCount = 1;

    // Handle both prospect and prospect_id parameters
    const prospectId = prospect || prospect_id;
    if (prospectId) {
      baseWhereConditions.push(`(ta.reference_docname = $${paramCount} OR ta.prospect_id::text = $${paramCount})`);
      params.push(prospectId);
      paramCount++;
    }

    if (company) {
      baseWhereConditions.push(`ta.organization_id = $${paramCount}`);
      params.push(company);
      paramCount++;
    }

    if (activity_types) {
      const types = JSON.parse(activity_types);
      baseWhereConditions.push(`ta.activity_type = ANY($${paramCount})`);
      params.push(types);
      paramCount++;
    }

    if (status) {
      const statuses = JSON.parse(status);
      // Get status IDs from status names
      const statusIdsResult = await pool.query(
        `SELECT id FROM activity_statuses WHERE status_name = ANY($1)`,
        [statuses]
      );
      const statusIds = statusIdsResult.rows.map(r => r.id);
      if (statusIds.length > 0) {
        baseWhereConditions.push(`ta.status_id = ANY($${paramCount})`);
        params.push(statusIds);
        paramCount++;
      }
    }

    if (assigned_to) {
      baseWhereConditions.push(`ta.assigned_to_id = $${paramCount}`);
      params.push(assigned_to);
      paramCount++;
    }

    if (date_from) {
      baseWhereConditions.push(`COALESCE(ta.completed_on, ta.date_time, ta.created_at) >= $${paramCount}`);
      params.push(date_from);
      paramCount++;
    }

    if (date_to) {
      baseWhereConditions.push(`COALESCE(ta.completed_on, ta.date_time, ta.created_at) <= $${paramCount}`);
      params.push(date_to);
      paramCount++;
    }

    const whereClause = baseWhereConditions.length > 0 
      ? `WHERE ${baseWhereConditions.join(' AND ')}`
      : 'WHERE 1=1';

    // Get total count (optimized - no JOINs needed)
    const countQuery = `
      SELECT COUNT(*) as count
      FROM tallac_activities ta
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery, params);
    const totalCount = parseInt(countResult.rows[0].count);

    // Main query with JOINs to get all data in one query (optimized)
    const start = (parseInt(page) - 1) * parseInt(page_size);
    const mainQuery = `
      SELECT 
        ta.id, 
        COALESCE(ta.activity_code, ta.name) as activity_code, 
        ta.activity_type, 
        COALESCE(ta.title, ta.subject) as subject, 
        ast.status_name as status, 
        ta.priority,
        COALESCE(ta.completed_on, ta.date_time, ta.created_at) as date_time, 
        ta.assigned_to_id, 
        ta.created_by_id, 
        ta.description, 
        COALESCE(ta.outcome_status, ta.call_outcome) as call_outcome, 
        ta.duration,
        ta.organization_id as company_id, 
        COALESCE(ta.contact_person_id, ta.contact_id) as contact_id, 
        COALESCE(ta.reference_docname, ta.prospect_id::text) as prospect_id,
        ta.scheduled_date, 
        ta.scheduled_time, 
        ta.created_at, 
        ta.updated_at,
        -- Join company name
        to_org.organization_name as company,
        -- Join created by user name
        created_by_user.full_name as created_by,
        -- Join assigned to user name
        assigned_to_user.full_name as assigned_to,
        -- Join status name (already aliased above)
        ast.status_name as status_name
      FROM tallac_activities ta
      LEFT JOIN tallac_organizations to_org ON ta.organization_id = to_org.id
      LEFT JOIN users created_by_user ON ta.created_by_id = created_by_user.id
      LEFT JOIN users assigned_to_user ON ta.assigned_to_id = assigned_to_user.id
      LEFT JOIN activity_statuses ast ON ta.status_id = ast.id
      ${whereClause}
      ORDER BY COALESCE(ta.completed_on, ta.date_time, ta.created_at) DESC NULLS LAST
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;
    params.push(parseInt(page_size), start);

    const result = await pool.query(mainQuery, params);

    // Enrich activities with queue status (no database queries needed)
    const enrichedActivities = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const activity of result.rows) {
      const enriched = { ...activity };

      // Calculate queue status
      if (activity.scheduled_date && ['Callback', 'Appointment'].includes(activity.activity_type)) {
        const scheduledDate = new Date(activity.scheduled_date);
        scheduledDate.setHours(0, 0, 0, 0);

        if (scheduledDate < today) {
          enriched.queue_status = 'overdue';
          enriched.queue_message = `Overdue: ${activity.activity_type}`;
        } else if (scheduledDate.getTime() === today.getTime()) {
          enriched.queue_status = 'today';
          enriched.queue_message = `Due Today: ${activity.activity_type}`;
        } else {
          enriched.queue_status = 'scheduled';
          enriched.queue_message = `Scheduled: ${activity.activity_type}`;
        }
      } else {
        enriched.queue_status = 'none';
        enriched.queue_message = '';
      }

      enrichedActivities.push(enriched);
    }

    // Get type counts in a single optimized query
    const typeCountsQuery = `
      SELECT 
        ta.activity_type,
        COUNT(*) as count
      FROM tallac_activities ta
      ${whereClause}
      GROUP BY ta.activity_type
    `;
    const typeCountsResult = await pool.query(typeCountsQuery, params.slice(0, -2));
    const typeCounts = {};
    const allTypes = ['Call Log', 'Callback', 'Appointment', 'Notes', 'Changes', 'Assignment'];
    allTypes.forEach(type => {
      typeCounts[type] = 0;
    });
    typeCountsResult.rows.forEach(row => {
      typeCounts[row.activity_type] = parseInt(row.count);
    });

    // Get status counts in a single optimized query
    const statusCountsQuery = `
      SELECT 
        COALESCE(ast.status_name, 'Unknown') as status_name,
        COUNT(*) as count
      FROM tallac_activities ta
      LEFT JOIN activity_statuses ast ON ta.status_id = ast.id
      ${whereClause}
      GROUP BY ast.status_name
    `;
    const statusCountsResult = await pool.query(statusCountsQuery, params.slice(0, -2));
    const statusCounts = {};
    statusCountsResult.rows.forEach(row => {
      statusCounts[row.status_name] = parseInt(row.count);
    });

    res.json({
      success: true,
      data: enrichedActivities,
      total_count: totalCount,
      page: parseInt(page),
      page_size: parseInt(page_size),
      total_pages: Math.ceil(totalCount / parseInt(page_size)),
      type_counts: typeCounts,
      status_counts: statusCounts
    });
  } catch (error) {
    console.error('Get all activities error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch activities', error: error.message });
  }
});

// Create call log activity
router.post('/call-log', authenticateToken, async (req, res) => {
  try {
    const {
      prospect, company, contact, start_time, end_time,
      call_outcome, description, subject, status
    } = req.body;

    if (!prospect) {
      return res.status(400).json({ success: false, message: 'Prospect is required' });
    }

    // Get status_id for the status name
    let statusId = null;
    if (status) {
      const statusResult = await pool.query(
        `SELECT id FROM activity_statuses WHERE status_name = $1`,
        [status]
      );
      statusId = statusResult.rows[0]?.id || null;
    }
    if (!statusId) {
      // Default to 'Completed' status
      const defaultStatusResult = await pool.query(
        `SELECT id FROM activity_statuses WHERE status_name = 'Completed'`,
        []
      );
      statusId = defaultStatusResult.rows[0]?.id || null;
    }

    const startTime = start_time ? new Date(start_time) : new Date();
    const endTime = end_time ? new Date(end_time) : null;
    const activityResult = await pool.query(
        `INSERT INTO tallac_activities 
         (activity_type, subject, title, status_id, reference_docname, reference_doctype, 
          organization_id, contact_person_id, contact_id, start_time, 
          date_time, completed_on, created_at, 
          call_outcome, outcome_status, description, assigned_to_id, created_by_id)
         VALUES ('Call Log', $1, $1, $2, $3, 'Prospect', $4, $5, $5, $6, $6, $7, $6, $8, $8, $9, $10, $11)
         RETURNING *`,
        [
          subject || 'Call in Progress...',
          statusId,
          prospect,
          company || null,
          contact || null,
          startTime,
          endTime,
          call_outcome || null,
          description || null,
          req.user.id,
          req.user.id
        ]
      );

    res.status(201).json({
      success: true,
      data: activityResult.rows[0]
    });
  } catch (error) {
    console.error('Create call log error:', error);
    res.status(500).json({ success: false, message: 'Failed to create call log', error: error.message });
  }
});

// Update call log activity
router.put('/call-log/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { end_time, call_outcome, description, subject } = req.body;

    const updates = [];
    const params = [];
    let paramCount = 1;

    // Note: end_time column doesn't exist in database, using completed_on instead
    if (end_time !== undefined) {
      updates.push(`completed_on = $${paramCount}`);
      params.push(end_time ? new Date(end_time) : null);
      paramCount++;
    }

    if (call_outcome !== undefined) {
      updates.push(`call_outcome = $${paramCount}, outcome_status = $${paramCount}`);
      params.push(call_outcome);
      paramCount++;
    }

    if (description !== undefined) {
      updates.push(`description = $${paramCount}`);
      params.push(description);
      paramCount++;
    }

    if (subject !== undefined) {
      updates.push(`subject = $${paramCount}`);
      params.push(subject);
      paramCount++;
    }

    if (end_time) {
      // Get 'Completed' status_id
      const statusResult = await pool.query(
        `SELECT id FROM activity_statuses WHERE status_name = 'Completed'`,
        []
      );
      if (statusResult.rows[0]) {
        updates.push(`status_id = $${paramCount}`);
        params.push(statusResult.rows[0].id);
        paramCount++;
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No updates provided' });
    }

    params.push(id);
    const result = await pool.query(
      `UPDATE tallac_activities 
       SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${paramCount}
       RETURNING *`,
      params
    );

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update call log error:', error);
    res.status(500).json({ success: false, message: 'Failed to update call log', error: error.message });
  }
});

// Create note activity
router.post('/note', authenticateToken, async (req, res) => {
  try {
    const { prospect, company, contact, description, subject } = req.body;

    if (!prospect) {
      return res.status(400).json({ success: false, message: 'Prospect is required' });
    }
    if (!description) {
      return res.status(400).json({ success: false, message: 'Note content is required' });
    }

    // Get 'Completed' status_id
    const statusResult = await pool.query(
      `SELECT id FROM activity_statuses WHERE status_name = 'Completed'`,
      []
    );
    const statusId = statusResult.rows[0]?.id || null;

    const activityResult = await pool.query(
      `INSERT INTO tallac_activities 
       (activity_type, subject, title, status_id, reference_docname, reference_doctype, 
        organization_id, contact_person_id, contact_id,
        description, assigned_to_id, created_by_id, created_at, completed_on, date_time)
       VALUES ('Notes', $1, $1, $2, $3, 'Prospect', $4, $5, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [
        subject || null,
        statusId,
        prospect,
        company || null,
        contact || null,
        description,
        req.user.id,
        req.user.id
      ]
    );

    res.status(201).json({
      success: true,
      data: activityResult.rows[0]
    });
  } catch (error) {
    console.error('Create note error:', error);
    res.status(500).json({ success: false, message: 'Failed to create note', error: error.message });
  }
});

// Create scheduled activity (Callback or Appointment)
router.post('/scheduled', authenticateToken, async (req, res) => {
  try {
    const {
      activity_type, prospect, company, contact, scheduled_date,
      scheduled_time, description, subject, assigned_to
    } = req.body;

    if (!['Callback', 'Appointment'].includes(activity_type)) {
      return res.status(400).json({ success: false, message: 'Activity type must be Callback or Appointment' });
    }

    if (!prospect || !scheduled_date || !scheduled_time) {
      return res.status(400).json({ success: false, message: 'Prospect, scheduled_date, and scheduled_time are required' });
    }

    // Get 'Open' status_id
    const statusResult = await pool.query(
      `SELECT id FROM activity_statuses WHERE status_name = 'Open'`,
      []
    );
    const statusId = statusResult.rows[0]?.id || null;

    const activityResult = await pool.query(
      `INSERT INTO tallac_activities 
       (activity_type, subject, title, status_id, reference_docname, reference_doctype, 
        organization_id, contact_person_id, contact_id,
        scheduled_date, scheduled_time, description, assigned_to_id, created_by_id, created_at)
       VALUES ($1, $2, $2, $3, $4, 'Prospect', $5, $6, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
       RETURNING *`,
      [
        activity_type,
        subject || null,
        statusId,
        prospect,
        company || null,
        contact || null,
        scheduled_date,
        scheduled_time,
        description || null,
        assigned_to || req.user.id,
        req.user.id
      ]
    );

    res.status(201).json({
      success: true,
      data: activityResult.rows[0]
    });
  } catch (error) {
    console.error('Create scheduled activity error:', error);
    res.status(500).json({ success: false, message: 'Failed to create scheduled activity', error: error.message });
  }
});

// Get upcoming activities
router.get('/upcoming', authenticateToken, async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const result = await pool.query(
      `SELECT 
        ta.id, 
        COALESCE(ta.activity_code, ta.name) as activity_code, 
        ta.activity_type, 
        COALESCE(ta.title, ta.subject) as subject, 
        ast.status_name as status, 
        ta.priority,
        ta.scheduled_date, ta.scheduled_time, ta.organization_id as company_id
      FROM tallac_activities ta
      LEFT JOIN activity_statuses ast ON ta.status_id = ast.id
      WHERE ta.assigned_to_id = $1
        AND ast.status_name IN ('Open', 'In Progress')
        AND ta.scheduled_date >= CURRENT_DATE
      ORDER BY ta.scheduled_date ASC, ta.scheduled_time ASC
      LIMIT $2`,
      [req.user.id, parseInt(limit)]
    );

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get upcoming activities error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch upcoming activities', error: error.message });
  }
});

// Get overdue activities
router.get('/overdue', authenticateToken, async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const result = await pool.query(
      `SELECT 
        ta.id, 
        COALESCE(ta.activity_code, ta.name) as activity_code, 
        ta.activity_type, 
        COALESCE(ta.title, ta.subject) as subject, 
        ast.status_name as status, 
        ta.priority,
        ta.scheduled_date, ta.scheduled_time, ta.organization_id as company_id
      FROM tallac_activities ta
      LEFT JOIN activity_statuses ast ON ta.status_id = ast.id
      WHERE ta.assigned_to_id = $1
        AND ast.status_name IN ('Open', 'In Progress')
        AND ta.scheduled_date < CURRENT_DATE
      ORDER BY ta.scheduled_date ASC, ta.scheduled_time ASC
      LIMIT $2`,
      [req.user.id, parseInt(limit)]
    );

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get overdue activities error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch overdue activities', error: error.message });
  }
});

export default router;

