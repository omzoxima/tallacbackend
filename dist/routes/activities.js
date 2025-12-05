"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const database_1 = require("../config/database");
const router = express_1.default.Router();
// Get high-level activity summary for fast counts on Activities page
router.get('/summary', async (req, res) => {
    try {
        const summaryQuery = `
      SELECT
        COUNT(*)::int as total_count,
        COUNT(*) FILTER (WHERE queue_status IN ('overdue', 'today'))::int as queue_count,
        COUNT(*) FILTER (WHERE queue_status = 'scheduled')::int as scheduled_count,
        COUNT(*) FILTER (WHERE LOWER(activity_type) = 'call-log')::int as call_log_count,
        COUNT(*) FILTER (WHERE LOWER(activity_type) = 'callback')::int as callback_count,
        COUNT(*) FILTER (WHERE LOWER(activity_type) = 'appointment')::int as appointment_count,
        COUNT(*) FILTER (WHERE LOWER(activity_type) IN ('note', 'notes'))::int as note_count,
        COUNT(*) FILTER (WHERE LOWER(activity_type) = 'changes')::int as changes_count,
        COUNT(*) FILTER (WHERE LOWER(activity_type) = 'assignment')::int as assignment_count
      FROM (
        SELECT 
          a.activity_type,
          CASE 
            WHEN a.scheduled_date < CURRENT_DATE AND s.status_name IN ('Open', 'In Progress') THEN 'overdue'
            WHEN a.scheduled_date = CURRENT_DATE AND s.status_name IN ('Open', 'In Progress') THEN 'today'
            WHEN a.scheduled_date > CURRENT_DATE AND s.status_name IN ('Open', 'In Progress') THEN 'scheduled'
            ELSE 'none'
          END as queue_status
        FROM tallac_activities a
        LEFT JOIN activity_statuses s ON a.status_id = s.id
      ) x;
    `;
        const result = await database_1.pool.query(summaryQuery);
        const row = result.rows[0] || {};
        return res.json({
            total_count: row.total_count || 0,
            queue_count: row.queue_count || 0,
            scheduled_count: row.scheduled_count || 0,
            call_log_count: row.call_log_count || 0,
            callback_count: row.callback_count || 0,
            appointment_count: row.appointment_count || 0,
            note_count: row.note_count || 0,
            changes_count: row.changes_count || 0,
            assignment_count: row.assignment_count || 0,
        });
    }
    catch (error) {
        console.error('Error fetching activities summary:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
// Get timeline activities
router.get('/timeline', async (req, res) => {
    try {
        const { reference_doctype, reference_docname, activity_types, limit = 100 } = req.query;
        if (!reference_doctype || !reference_docname) {
            return res.status(400).json({ error: 'reference_doctype and reference_docname are required' });
        }
        const types = activity_types
            ? (typeof activity_types === 'string' ? JSON.parse(activity_types) : activity_types)
            : ['activity', 'call_log', 'note'];
        // Performance optimization: Run all queries in parallel instead of sequentially
        const queryPromises = [];
        // Get Tallac Activities
        if (types.includes('activity')) {
            queryPromises.push(database_1.pool.query(`
          SELECT 
            a.*,
            s.status_name,
            u.full_name as assigned_to_name,
            c.full_name as contact_name,
            o.organization_name,
            'activity' as timeline_type,
            COALESCE(a.scheduled_date, a.created_at) as display_date
          FROM tallac_activities a
          LEFT JOIN activity_statuses s ON a.status_id = s.id
          LEFT JOIN users u ON a.assigned_to_id = u.id
          LEFT JOIN tallac_contacts c ON a.contact_person_id = c.id
          LEFT JOIN tallac_organizations o ON a.organization_id = o.id
          WHERE a.reference_doctype = $1 AND a.reference_docname = $2
          ORDER BY a.scheduled_date DESC, a.scheduled_time DESC
          LIMIT $3
        `, [reference_doctype, reference_docname, limit]));
        }
        else {
            queryPromises.push(Promise.resolve({ rows: [] }));
        }
        // Get Call Logs
        if (types.includes('call_log')) {
            queryPromises.push(database_1.pool.query(`
          SELECT 
            cl.*,
            cs.status_name as call_status_name,
            u.full_name as handled_by_name,
            c.full_name as contact_name,
            o.organization_name,
            'call_log' as timeline_type,
            COALESCE(cl.call_date, cl.created_at) as display_date
          FROM tallac_call_logs cl
          LEFT JOIN call_statuses cs ON cl.call_status_id = cs.id
          LEFT JOIN users u ON cl.handled_by_id = u.id
          LEFT JOIN tallac_contacts c ON cl.contact_person_id = c.id
          LEFT JOIN tallac_organizations o ON cl.organization_id = o.id
          WHERE cl.reference_doctype = $1 AND cl.reference_docname = $2
          ORDER BY cl.call_date DESC, cl.call_time DESC
          LIMIT $3
        `, [reference_doctype, reference_docname, limit]));
        }
        else {
            queryPromises.push(Promise.resolve({ rows: [] }));
        }
        // Get Notes
        if (types.includes('note')) {
            queryPromises.push(database_1.pool.query(`
          SELECT 
            n.*,
            u.full_name as created_by_name,
            'note' as timeline_type,
            n.created_at as display_date
          FROM tallac_notes n
          LEFT JOIN users u ON n.created_by_id = u.id
          WHERE n.reference_doctype = $1 AND n.reference_docname = $2
          ORDER BY n.created_at DESC
          LIMIT $3
        `, [reference_doctype, reference_docname, limit]));
        }
        else {
            queryPromises.push(Promise.resolve({ rows: [] }));
        }
        // Execute all queries in parallel
        const [activitiesResult, callLogsResult, notesResult] = await Promise.all(queryPromises);
        // Combine all results
        const activities = [
            ...activitiesResult.rows,
            ...callLogsResult.rows,
            ...notesResult.rows
        ];
        // Sort by display_date
        activities.sort((a, b) => {
            const dateA = new Date(a.display_date).getTime();
            const dateB = new Date(b.display_date).getTime();
            return dateB - dateA;
        });
        res.json(activities.slice(0, parseInt(limit)));
    }
    catch (error) {
        console.error('Error fetching timeline activities:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get all activities with filters
router.get('/', async (req, res) => {
    try {
        const { activity_type, status, assigned_to, created_by, company, scheduled_date_from, scheduled_date_to, limit = 1000, offset = 0, } = req.query;
        let query = `
      SELECT 
        a.*,
        s.status_name,
        u.full_name as assigned_to_name,
        u2.full_name as created_by_name,
        c.full_name as contact_name,
        COALESCE(o.organization_name, l.company_name) as company,
        CASE 
          WHEN a.scheduled_date < CURRENT_DATE AND s.status_name IN ('Open', 'In Progress') THEN 'overdue'
          WHEN a.scheduled_date = CURRENT_DATE AND s.status_name IN ('Open', 'In Progress') THEN 'today'
          WHEN a.scheduled_date > CURRENT_DATE AND s.status_name IN ('Open', 'In Progress') THEN 'scheduled'
          ELSE 'none'
        END as queue_status,
        CASE 
          WHEN a.scheduled_date < CURRENT_DATE AND s.status_name IN ('Open', 'In Progress') THEN 'Overdue: Action required'
          WHEN a.scheduled_date = CURRENT_DATE AND s.status_name IN ('Open', 'In Progress') THEN 'Due Today: Action required'
          WHEN a.scheduled_date > CURRENT_DATE AND s.status_name IN ('Open', 'In Progress') THEN 'Scheduled: ' || a.scheduled_date::text
          ELSE NULL
        END as queue_message
      FROM tallac_activities a
      LEFT JOIN activity_statuses s ON a.status_id = s.id
      LEFT JOIN users u ON a.assigned_to_id = u.id
      LEFT JOIN users u2 ON a.created_by_id = u2.id
      LEFT JOIN tallac_contacts c ON a.contact_person_id = c.id
      LEFT JOIN tallac_organizations o ON a.organization_id = o.id
      LEFT JOIN tallac_leads l ON a.reference_docname = l.name AND a.reference_doctype = 'Tallac Lead'
      WHERE 1=1
    `;
        const params = [];
        let paramCount = 0;
        if (activity_type) {
            paramCount++;
            query += ` AND a.activity_type = $${paramCount}`;
            params.push(activity_type);
        }
        if (status) {
            paramCount++;
            query += ` AND s.status_name = $${paramCount}`;
            params.push(status);
        }
        if (assigned_to) {
            paramCount++;
            query += ` AND u.full_name = $${paramCount}`;
            params.push(assigned_to);
        }
        if (created_by) {
            paramCount++;
            query += ` AND u2.full_name = $${paramCount}`;
            params.push(created_by);
        }
        if (company) {
            paramCount++;
            query += ` AND (o.organization_name = $${paramCount} OR l.company_name = $${paramCount})`;
            params.push(company);
        }
        if (scheduled_date_from) {
            paramCount++;
            query += ` AND a.scheduled_date >= $${paramCount}`;
            params.push(scheduled_date_from);
        }
        if (scheduled_date_to) {
            paramCount++;
            query += ` AND a.scheduled_date <= $${paramCount}`;
            params.push(scheduled_date_to);
        }
        query += ` ORDER BY a.scheduled_date DESC, a.scheduled_time DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        params.push(parseInt(limit), parseInt(offset));
        const result = await database_1.pool.query(query, params);
        res.json(result.rows);
    }
    catch (error) {
        console.error('Error fetching activities:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Create activity
router.post('/', async (req, res) => {
    try {
        const activityData = req.body;
        // Get status_id
        const statusQuery = await database_1.pool.query('SELECT id FROM activity_statuses WHERE status_name = $1', [activityData.status || 'Open']);
        if (statusQuery.rows.length === 0) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        const statusId = statusQuery.rows[0].id;
        // Generate name (TACT-00001 format)
        const nameQuery = await database_1.pool.query('SELECT COUNT(*) as count FROM tallac_activities');
        const count = parseInt(nameQuery.rows[0].count) + 1;
        const name = `TACT-${String(count).padStart(5, '0')}`;
        const insertQuery = `
      INSERT INTO tallac_activities (
        name, activity_type, title, status_id, priority,
        scheduled_date, scheduled_time, assigned_to_id, created_by_id,
        description, reference_doctype, reference_docname,
        contact_person_id, organization_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;
        const result = await database_1.pool.query(insertQuery, [
            name,
            activityData.activity_type || 'Callback',
            activityData.title,
            statusId,
            activityData.priority || 'Medium',
            activityData.scheduled_date,
            activityData.scheduled_time,
            activityData.assigned_to_id,
            activityData.created_by_id || null,
            activityData.description || null,
            activityData.reference_doctype || null,
            activityData.reference_docname || null,
            activityData.contact_person_id || null,
            activityData.organization_id || null,
        ]);
        res.status(201).json(result.rows[0]);
    }
    catch (error) {
        console.error('Error creating activity:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Update activity
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const activityData = req.body;
        const updateFields = [];
        const values = [];
        let paramCount = 0;
        if (activityData.status) {
            const statusQuery = await database_1.pool.query('SELECT id FROM activity_statuses WHERE status_name = $1', [activityData.status]);
            if (statusQuery.rows.length > 0) {
                paramCount++;
                updateFields.push(`status_id = $${paramCount}`);
                values.push(statusQuery.rows[0].id);
            }
        }
        Object.keys(activityData).forEach((key) => {
            if (key !== 'id' && key !== 'name' && key !== 'status' && key !== 'created_at') {
                paramCount++;
                updateFields.push(`${key} = $${paramCount}`);
                values.push(activityData[key]);
            }
        });
        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }
        paramCount++;
        updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(id);
        const query = `
      UPDATE tallac_activities
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount} OR name = $${paramCount}
      RETURNING *
    `;
        const result = await database_1.pool.query(query, values);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Activity not found' });
        }
        res.json(result.rows[0]);
    }
    catch (error) {
        console.error('Error updating activity:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Mark activity as complete
router.patch('/:id/complete', async (req, res) => {
    try {
        const { id } = req.params;
        // Get 'Completed' status ID
        const statusQuery = await database_1.pool.query('SELECT id FROM activity_statuses WHERE status_name = $1', ['Completed']);
        if (statusQuery.rows.length === 0) {
            return res.status(400).json({ error: 'Completed status not found' });
        }
        const completedStatusId = statusQuery.rows[0].id;
        // Update activity status
        const updateQuery = `
      UPDATE tallac_activities
      SET status_id = $1, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2::uuid
      RETURNING *
    `;
        const result = await database_1.pool.query(updateQuery, [completedStatusId, id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Activity not found' });
        }
        res.json({ success: true, activity: result.rows[0] });
    }
    catch (error) {
        console.error('Error completing activity:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
//# sourceMappingURL=activities.js.map