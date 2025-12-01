import express from 'express';
import { pool } from '../config/database';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Create call log (record call outcome)
router.post('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const {
      lead_id,
      prospect_name,
      phone_number,
      outcome,
      notes,
      tags = [],
      duration_seconds,
    } = req.body;

    if (!lead_id || !outcome || !notes) {
      return res.status(400).json({ error: 'lead_id, outcome and notes are required' });
    }

    // Resolve call_status_id from outcome text
    const statusResult = await pool.query(
      'SELECT id FROM call_statuses WHERE LOWER(status_name) = LOWER($1) LIMIT 1',
      [outcome]
    );

    if (statusResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid call outcome' });
    }

    const callStatusId = statusResult.rows[0].id;

    // Generate TCALL-00001 style name
    const nameQuery = await pool.query('SELECT COUNT(*) as count FROM tallac_call_logs');
    const count = parseInt(nameQuery.rows[0].count) + 1;
    const name = `TCALL-${String(count).padStart(5, '0')}`;

    const handledById = req.user?.userId || null;

    const insertQuery = `
      INSERT INTO tallac_call_logs (
        name,
        call_type,
        call_status_id,
        call_date,
        call_time,
        call_outcome,
        handled_by_id,
        caller_number,
        receiver_number,
        call_duration,
        reference_doctype,
        reference_docname,
        call_summary,
        call_notes
      ) VALUES (
        $1, $2, $3, CURRENT_DATE, CURRENT_TIME,
        $4, $5, $6, $7, $8,
        $9, $10, $11, $12
      )
      RETURNING *
    `;

    const summary =
      Array.isArray(tags) && tags.length > 0
        ? `Tags: ${tags.join(', ')}`
        : null;

    const result = await pool.query(insertQuery, [
      name,
      'Outgoing',
      callStatusId,
      outcome,
      handledById,
      null, // caller_number (not tracked yet)
      phone_number || null,
      typeof duration_seconds === 'number' ? duration_seconds : null,
      'Tallac Lead',
      lead_id,
      summary,
      notes,
    ]);

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating call log:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;


