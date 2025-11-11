import express from 'express';
import { pool } from '../config/database';
import { authenticateToken, requireRole, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Get all companies
router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { search, status, territory_id, limit = 100, offset = 0 } = req.query;

    let query = `
      SELECT 
        c.*,
        t.territory_name,
        o.organization_name
      FROM companies c
      LEFT JOIN tallac_territories t ON c.territory_id = t.id
      LEFT JOIN tallac_organizations o ON c.organization_id = o.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramCount = 1;

    if (search) {
      // Search in company_name, doing_business_as, and industry fields
      query += ` AND (
        c.company_name ILIKE $${paramCount} 
        OR c.doing_business_as ILIKE $${paramCount} 
        OR c.industry ILIKE $${paramCount}
      )`;
      params.push(`%${search}%`);
      paramCount++;
    }

    if (status && status !== 'all') {
      query += ` AND c.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    if (territory_id) {
      query += ` AND c.territory_id = $${paramCount}`;
      params.push(territory_id);
      paramCount++;
    }

    query += ` ORDER BY c.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    
    // Map database fields to API response format (support both formats)
    const mappedRows = result.rows.map(row => ({
      ...row,
      // Support both name and company_name
      name: row.company_name || row.name,
      // Support both industries (plural) and industry (singular)
      industries: row.industry || row.industries,
      // Keep original fields for backward compatibility
      company_name: row.company_name || row.name,
      industry: row.industry || row.industries,
    }));
    
    res.json(mappedRows);
  } catch (error) {
    console.error('Error fetching companies:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get company by ID
router.get('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT 
        c.*,
        t.territory_name,
        o.organization_name
      FROM companies c
      LEFT JOIN tallac_territories t ON c.territory_id = t.id
      LEFT JOIN tallac_organizations o ON c.organization_id = o.id
      WHERE c.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const row = result.rows[0];
    // Map database fields to API response format (support both formats)
    const mappedRow = {
      ...row,
      name: row.company_name || row.name,
      industries: row.industry || row.industries,
      company_name: row.company_name || row.name,
      industry: row.industry || row.industries,
    };

    res.json(mappedRow);
  } catch (error) {
    console.error('Error fetching company:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create company (Corporate Admin, Territory Admin only)
router.post('/', authenticateToken, requireRole('Corporate Admin', 'Territory Admin'), async (req: AuthRequest, res) => {
  try {
    const {
      company_name,
      doing_business_as,
      industry,
      status,
      territory_owner,
      mobile,
      address,
      territory_manager_email,
      email,
      map_address,
      full_address,
      location_summary,
      zip_code,
      city,
      state,
      territory_id,
      truck_count,
      driver_count,
      employee_count,
      annual_revenue,
      years_in_business,
      business_type,
      organization_id
    } = req.body;

    if (!company_name) {
      return res.status(400).json({ error: 'Company name is required' });
    }

    const result = await pool.query(
      `INSERT INTO companies (
        company_name, doing_business_as, industry, status,
        territory_owner, mobile, address, territory_manager_email, email, map_address,
        full_address, location_summary, zip_code, city, state, territory_id,
        truck_count, driver_count, employee_count, annual_revenue, years_in_business, business_type,
        organization_id, created_by_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
      RETURNING *`,
      [
        company_name, doing_business_as, industry, status || 'Active',
        territory_owner, mobile, address, territory_manager_email, email, map_address,
        full_address, location_summary, zip_code, city, state, territory_id,
        truck_count, driver_count, employee_count, annual_revenue, years_in_business, business_type,
        organization_id, req.user?.userId
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating company:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update company (Corporate Admin, Territory Admin only)
router.put('/:id', authenticateToken, requireRole('Corporate Admin', 'Territory Admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const {
      company_name,
      name, // Support name field from API
      doing_business_as,
      industry,
      industries, // Support industries field from API
      status,
      territory_owner,
      mobile,
      address,
      territory_manager_email,
      email,
      map_address,
      full_address,
      location_summary,
      zip_code,
      city,
      state,
      territory_id,
      truck_count,
      driver_count,
      employee_count,
      annual_revenue,
      years_in_business,
      business_type,
      organization_id
    } = req.body;

    // Use name if company_name is not provided, use industries if industry is not provided
    const finalCompanyName = company_name || name;
    const finalIndustry = industry || industries;

    const result = await pool.query(
      `UPDATE companies SET
        company_name = COALESCE($1, company_name),
        doing_business_as = COALESCE($2, doing_business_as),
        industry = COALESCE($3, industry),
        status = COALESCE($4, status),
        territory_owner = COALESCE($5, territory_owner),
        mobile = COALESCE($6, mobile),
        address = COALESCE($7, address),
        territory_manager_email = COALESCE($8, territory_manager_email),
        email = COALESCE($9, email),
        map_address = COALESCE($10, map_address),
        full_address = COALESCE($11, full_address),
        location_summary = COALESCE($12, location_summary),
        zip_code = COALESCE($13, zip_code),
        city = COALESCE($14, city),
        state = COALESCE($15, state),
        territory_id = COALESCE($16, territory_id),
        truck_count = COALESCE($17, truck_count),
        driver_count = COALESCE($18, driver_count),
        employee_count = COALESCE($19, employee_count),
        annual_revenue = COALESCE($20, annual_revenue),
        years_in_business = COALESCE($21, years_in_business),
        business_type = COALESCE($22, business_type),
        organization_id = COALESCE($23, organization_id),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $24
      RETURNING *`,
      [
        finalCompanyName, doing_business_as, finalIndustry, status,
        territory_owner, mobile, address, territory_manager_email, email, map_address,
        full_address, location_summary, zip_code, city, state, territory_id,
        truck_count, driver_count, employee_count, annual_revenue, years_in_business, business_type,
        organization_id, id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const row = result.rows[0];
    // Map response to include both formats
    const mappedRow = {
      ...row,
      name: row.company_name,
      industries: row.industry,
    };

    res.json(mappedRow);
  } catch (error) {
    console.error('Error updating company:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk update companies territory (Corporate Admin, Territory Admin only)
router.put('/bulk/territory', authenticateToken, requireRole('Corporate Admin', 'Territory Admin'), async (req: AuthRequest, res) => {
  try {
    const { company_ids, territory_id } = req.body;

    if (!company_ids || !Array.isArray(company_ids) || company_ids.length === 0) {
      return res.status(400).json({ error: 'company_ids array is required' });
    }

    if (!territory_id) {
      return res.status(400).json({ error: 'territory_id is required' });
    }

    // Update all companies with the territory_id
    const placeholders = company_ids.map((_, index) => `$${index + 2}`).join(',');
    const query = `
      UPDATE companies 
      SET territory_id = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id IN (${placeholders})
      RETURNING id, company_name, territory_id
    `;

    const params = [territory_id, ...company_ids];
    const result = await pool.query(query, params);

    res.json({
      message: `Successfully updated ${result.rows.length} companies`,
      updated_count: result.rows.length,
      companies: result.rows
    });
  } catch (error) {
    console.error('Error bulk updating companies:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete company (Corporate Admin only)
router.delete('/:id', authenticateToken, requireRole('Corporate Admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM companies WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }

    res.json({ message: 'Company deleted successfully' });
  } catch (error) {
    console.error('Error deleting company:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

