import express from 'express';
import { pool } from '../config/database';
import { authenticateToken, requireRole, AuthRequest } from '../middleware/auth';

const router = express.Router();

/**
 * GET /api/industries
 * Get all industries
 * Matches: tallac.api.prospects.get_industries
 */
router.get('/', async (req, res) => {
  try {
    const { search, limit = 100 } = req.query;

    let query = `
      SELECT 
        id,
        industry_code,
        industry_name,
        description,
        created_at
      FROM tallac_industries
      WHERE 1=1
    `;
    
    const params: any[] = [];
    let paramCount = 1;

    // Search filter
    if (search && typeof search === 'string') {
      query += ` AND (
        industry_name ILIKE $${paramCount} 
        OR industry_code ILIKE $${paramCount}
        OR description ILIKE $${paramCount}
      )`;
      params.push(`%${search}%`);
      paramCount++;
    }

    query += ` ORDER BY industry_name ASC LIMIT $${paramCount}`;
    params.push(parseInt(limit as string));

    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching industries:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

/**
 * GET /api/industries/:id
 * Get single industry by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      SELECT 
        id,
        industry_code,
        industry_name,
        description,
        created_at,
        updated_at
      FROM tallac_industries
      WHERE id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Industry not found' 
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching industry:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

/**
 * POST /api/industries
 * Create a new industry
 * Requires authentication - Corporate Admin or Territory Admin
 */
router.post('/', authenticateToken, requireRole('Corporate Admin', 'Territory Admin'), async (req: AuthRequest, res) => {
  try {
    const {
      industry_code,
      industry_name,
      description
    } = req.body;

    // Validate required fields
    if (!industry_code || !industry_name) {
      return res.status(400).json({ 
        success: false,
        error: 'Industry code and name are required' 
      });
    }

    // Check for duplicate
    const duplicateCheck = await pool.query(
      'SELECT id FROM tallac_industries WHERE industry_code = $1 OR LOWER(industry_name) = LOWER($2)',
      [industry_code, industry_name]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({ 
        success: false,
        error: 'Industry with this code or name already exists' 
      });
    }

    // Create industry
    const result = await pool.query(`
      INSERT INTO tallac_industries (
        industry_code,
        industry_name,
        description,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `, [industry_code, industry_name, description || null]);

    res.status(201).json({
      success: true,
      data: result.rows[0],
      message: 'Industry created successfully'
    });
  } catch (error: any) {
    console.error('Error creating industry:', error);
    
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ 
        success: false,
        error: 'Industry with this code or name already exists' 
      });
    }
    
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

/**
 * PUT /api/industries/:id
 * Update an existing industry
 * Requires authentication - Corporate Admin or Territory Admin
 */
router.put('/:id', authenticateToken, requireRole('Corporate Admin', 'Territory Admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const {
      industry_code,
      industry_name,
      description
    } = req.body;

    // Check if industry exists
    const existingIndustry = await pool.query(
      'SELECT id FROM tallac_industries WHERE id = $1',
      [id]
    );

    if (existingIndustry.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Industry not found' 
      });
    }

    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (industry_code !== undefined) {
      updates.push(`industry_code = $${paramCount}`);
      values.push(industry_code);
      paramCount++;
    }
    if (industry_name !== undefined) {
      updates.push(`industry_name = $${paramCount}`);
      values.push(industry_name);
      paramCount++;
    }
    if (description !== undefined) {
      updates.push(`description = $${paramCount}`);
      values.push(description);
      paramCount++;
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id); // For WHERE clause

    const updateQuery = `
      UPDATE tallac_industries 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(updateQuery, values);

    res.json({
      success: true,
      data: result.rows[0],
      message: 'Industry updated successfully'
    });
  } catch (error: any) {
    console.error('Error updating industry:', error);
    
    if (error.code === '23505') {
      return res.status(400).json({ 
        success: false,
        error: 'Industry with this code or name already exists' 
      });
    }
    
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

/**
 * DELETE /api/industries/:id
 * Delete an industry
 * Only Corporate Admin can delete
 */
router.delete('/:id', authenticateToken, requireRole('Corporate Admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    // Check if industry is used by any organizations
    const usageCheck = await pool.query(
      'SELECT COUNT(*) as count FROM tallac_organizations WHERE industry = (SELECT industry_code FROM tallac_industries WHERE id = $1)',
      [id]
    );

    if (parseInt(usageCheck.rows[0].count) > 0) {
      return res.status(400).json({ 
        success: false,
        error: 'Cannot delete industry that is being used by organizations' 
      });
    }

    // Delete industry
    const result = await pool.query(
      'DELETE FROM tallac_industries WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Industry not found' 
      });
    }

    res.json({
      success: true,
      message: 'Industry deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting industry:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

export default router;

