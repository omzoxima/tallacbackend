"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const database_1 = require("../config/database");
const router = express_1.default.Router();
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
        const activities = [];
        // Get Tallac Activities
        if (types.includes('activity')) {
            const query = `
        SELECT 
          a.*,
          s.status_name,
          u.full_name as assigned_to_name,
          c.full_name as contact_name,
          o.organization_name
        FROM tallac_activities a
        LEFT JOIN activity_statuses s ON a.status_id = s.id
        LEFT JOIN users u ON a.assigned_to_id = u.id
        LEFT JOIN tallac_contacts c ON a.contact_person_id = c.id
        LEFT JOIN tallac_organizations o ON a.organization_id = o.id
        WHERE a.reference_doctype = $1 AND a.reference_docname = $2
        ORDER BY a.scheduled_date DESC, a.scheduled_time DESC
        LIMIT $3
      `;
            const result = await database_1.pool.query(query, [reference_doctype, reference_docname, limit]);
            result.rows.forEach((row) => {
                activities.push({
                    ...row,
                    timeline_type: 'activity',
                    display_date: row.scheduled_date || row.created_at,
                });
            });
        }
        // Get Call Logs
        if (types.includes('call_log')) {
            const query = `
        SELECT 
          cl.*,
          cs.status_name as call_status_name,
          u.full_name as handled_by_name,
          c.full_name as contact_name,
          o.organization_name
        FROM tallac_call_logs cl
        LEFT JOIN call_statuses cs ON cl.call_status_id = cs.id
        LEFT JOIN users u ON cl.handled_by_id = u.id
        LEFT JOIN tallac_contacts c ON cl.contact_person_id = c.id
        LEFT JOIN tallac_organizations o ON cl.organization_id = o.id
        WHERE cl.reference_doctype = $1 AND cl.reference_docname = $2
        ORDER BY cl.call_date DESC, cl.call_time DESC
        LIMIT $3
      `;
            const result = await database_1.pool.query(query, [reference_doctype, reference_docname, limit]);
            result.rows.forEach((row) => {
                activities.push({
                    ...row,
                    timeline_type: 'call_log',
                    display_date: row.call_date || row.created_at,
                });
            });
        }
        // Get Notes
        if (types.includes('note')) {
            const query = `
        SELECT 
          n.*,
          u.full_name as created_by_name
        FROM tallac_notes n
        LEFT JOIN users u ON n.created_by_id = u.id
        WHERE n.reference_doctype = $1 AND n.reference_docname = $2
        ORDER BY n.created_at DESC
        LIMIT $3
      `;
            const result = await database_1.pool.query(query, [reference_doctype, reference_docname, limit]);
            result.rows.forEach((row) => {
                activities.push({
                    ...row,
                    timeline_type: 'note',
                    display_date: row.created_at,
                });
            });
        }
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
        const { activity_type, status, assigned_to, scheduled_date_from, scheduled_date_to, limit = 50, offset = 0, } = req.query;
        let query = `
      SELECT 
        a.*,
        s.status_name,
        u.full_name as assigned_to_name,
        u2.full_name as created_by_name,
        c.full_name as contact_name,
        COALESCE(o.organization_name, l.company_name) as company
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
            query += ` AND a.assigned_to_id = $${paramCount}`;
            params.push(assigned_to);
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
exports.default = router;
//# sourceMappingURL=activities.js.map