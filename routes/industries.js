import express from 'express';
import pool from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get all industries
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, industry_code as code, industry_name as name
       FROM tallac_industries
       ORDER BY industry_name ASC`
    );

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get industries error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch industries', error: error.message });
  }
});

// Create industry
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { industry_code, industry_name } = req.body;

    if (!industry_code || !industry_name) {
      return res.status(400).json({ success: false, message: 'Industry code and name are required' });
    }

    const result = await pool.query(
      `INSERT INTO tallac_industries (industry_code, industry_name)
       VALUES ($1, $2)
       ON CONFLICT (industry_code) DO UPDATE SET industry_name = EXCLUDED.industry_name
       RETURNING *`,
      [industry_code, industry_name]
    );

    res.status(201).json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Create industry error:', error);
    res.status(500).json({ success: false, message: 'Failed to create industry', error: error.message });
  }
});

export default router;

