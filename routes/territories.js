import express from 'express';
import pool from '../config/database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// Search territories (MUST be before /:id route)
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const { query, limit = 50 } = req.query;

    if (!query || query.length < 1) {
      return res.json({ success: true, data: [], count: 0 });
    }

    const result = await pool.query(
      `SELECT 
        id, territory_code, territory_name, territory_dba, territory_region,
        territory_state, territory_status
      FROM tallac_territories
      WHERE (
        territory_name ILIKE $1 OR
        territory_code ILIKE $1 OR
        COALESCE(territory_dba, '') ILIKE $1 OR
        COALESCE(territory_state, '') ILIKE $1 OR
        COALESCE(territory_region, '') ILIKE $1
      )
      ORDER BY territory_name ASC
      LIMIT $2`,
      [`%${query}%`, parseInt(limit)]
    );

    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Search territories error:', error);
    res.status(500).json({ success: false, message: 'Failed to search territories', error: error.message });
  }
});

// Get territory filters (MUST be before /:id route)
router.get('/filters/options', authenticateToken, async (req, res) => {
  try {
    const regionsResult = await pool.query(
      `SELECT DISTINCT territory_region 
       FROM tallac_territories 
       WHERE territory_region IS NOT NULL 
       ORDER BY territory_region`
    );
    const statesResult = await pool.query(
      `SELECT DISTINCT territory_state 
       FROM tallac_territories 
       WHERE territory_state IS NOT NULL 
       ORDER BY territory_state`
    );

    res.json({
      success: true,
      data: {
        regions: regionsResult.rows.map(r => r.territory_region),
        states: statesResult.rows.map(r => r.territory_state)
      }
    });
  } catch (error) {
    console.error('Get territory filters error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch filters', error: error.message });
  }
});

// Get all territories
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { filters, fields, limit_page_length, limit_start = 0, search } = req.query;

    let query = `
      SELECT 
        id, territory_code, territory_name, territory_dba, territory_region,
        territory_state, territory_status, territory_email, territory_mobile,
        is_group, parent_territory_id, created_at, updated_at
      FROM tallac_territories
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    // Apply search filter if provided
    if (search) {
      query += ` AND (
        territory_name ILIKE $${paramCount} OR
        territory_code ILIKE $${paramCount} OR
        COALESCE(territory_dba, '') ILIKE $${paramCount} OR
        COALESCE(territory_state, '') ILIKE $${paramCount} OR
        COALESCE(territory_region, '') ILIKE $${paramCount}
      )`;
      params.push(`%${search}%`);
      paramCount++;
    }

    // Apply filters if provided
    if (filters) {
      const filterObj = typeof filters === 'string' ? JSON.parse(filters) : filters;
      for (const [key, value] of Object.entries(filterObj)) {
        query += ` AND ${key} = $${paramCount}`;
        params.push(value);
        paramCount++;
      }
    }

    query += ` ORDER BY territory_name ASC`;

    if (limit_page_length) {
      query += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
      params.push(parseInt(limit_page_length), parseInt(limit_start));
    }

    const result = await pool.query(query, params);
    const territoryIds = result.rows.map(t => t.id);

    // OPTIMIZED: Batch query all zipcodes for all territories at once
    const allZipcodesResult = territoryIds.length > 0 ? await pool.query(
      `SELECT territory_id, zip_code 
       FROM territory_zipcodes 
       WHERE territory_id = ANY($1)
       ORDER BY territory_id, zip_code`,
      [territoryIds]
    ) : { rows: [] };

    // Get all unique zip codes
    const allZipCodes = [...new Set(allZipcodesResult.rows.map(z => z.zip_code))];

    // OPTIMIZED: Batch query all zipcode details at once
    const zipDetailsResult = allZipCodes.length > 0 ? await pool.query(
          `SELECT zip_code, city, county_name, state_name, state, timezone, population, density
           FROM tallac_zipcodes
           WHERE zip_code = ANY($1)`,
      [allZipCodes]
    ) : { rows: [] };
    const zipDetailsMap = {};
    for (const zip of zipDetailsResult.rows) {
      zipDetailsMap[zip.zip_code] = zip;
      }

    // OPTIMIZED: Batch query all partners for all territories at once
    const allPartnersResult = territoryIds.length > 0 ? await pool.query(
      `SELECT pt.territory_id, pt.partner_id, p.partner_name, p.partner_code, p.partner_status
         FROM partner_territories pt
         JOIN tallac_partners p ON pt.partner_id = p.id
       WHERE pt.territory_id = ANY($1)
       ORDER BY pt.territory_id, p.partner_name ASC`,
      [territoryIds]
    ) : { rows: [] };

    // Group zipcodes and partners by territory
    const zipcodesByTerritory = {};
    for (const zipcode of allZipcodesResult.rows) {
      if (!zipcodesByTerritory[zipcode.territory_id]) {
        zipcodesByTerritory[zipcode.territory_id] = [];
      }
      zipcodesByTerritory[zipcode.territory_id].push(zipcode.zip_code);
    }

    const partnersByTerritory = {};
    for (const partner of allPartnersResult.rows) {
      if (!partnersByTerritory[partner.territory_id]) {
        partnersByTerritory[partner.territory_id] = [];
      }
      partnersByTerritory[partner.territory_id].push({
        partner_id: partner.partner_id,
        partner_name: partner.partner_name,
        partner_code: partner.partner_code,
        partner_status: partner.partner_status
      });
    }

    // Enrich territories with batch-queried data
    for (const territory of result.rows) {
      territory.zipcodes_list = zipcodesByTerritory[territory.id] || [];
      territory.zipcode_count = territory.zipcodes_list.length;

      // Map zipcode details
      territory.zipcodes = territory.zipcodes_list.map(zipCode => 
        zipDetailsMap[zipCode] || { zip_code: zipCode }
      );

      territory.partners = partnersByTerritory[territory.id] || [];
    }

    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Get territories error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch territories', error: error.message });
  }
});

// Get single territory
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ success: false, message: 'Invalid territory ID format' });
    }

    const result = await pool.query(
      `SELECT * FROM tallac_territories WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Territory not found' });
    }

    const territory = result.rows[0];

    // Get zipcodes
    const zipcodesResult = await pool.query(
      `SELECT zip_code FROM territory_zipcodes WHERE territory_id = $1`,
      [id]
    );
    territory.zipcodes_list = zipcodesResult.rows.map(r => r.zip_code);
    territory.zipcode_count = territory.zipcodes_list.length;

    // Get zipcode details
    if (territory.zipcodes_list.length > 0) {
      const zipDetailsResult = await pool.query(
        `SELECT zip_code, city, county_name, state_name, state, timezone, population, density
         FROM tallac_zipcodes
         WHERE zip_code = ANY($1)`,
        [territory.zipcodes_list]
      );
      territory.zipcodes = zipDetailsResult.rows;
    } else {
      territory.zipcodes = [];
    }

    // Get partners
    const partnersResult = await pool.query(
      `SELECT pt.partner_id, p.partner_name, p.partner_code, p.partner_status
       FROM partner_territories pt
       JOIN tallac_partners p ON pt.partner_id = p.id
       WHERE pt.territory_id = $1`,
      [id]
    );
    territory.partners = partnersResult.rows;

    res.json({
      success: true,
      data: territory
    });
  } catch (error) {
    console.error('Get territory error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch territory', error: error.message });
  }
});

// Create territory
router.post('/', authenticateToken, requireRole('Corporate Admin'), async (req, res) => {
  try {
    const {
      territory_code, territory_name, territory_dba, territory_region,
      territory_state, territory_status, territory_email, territory_mobile,
      is_group, parent_territory_id, zipcodes, territory_zipcodes
    } = req.body;

    console.log('\n=== CREATE TERRITORY API CALL ===');
    console.log('Request Body:', JSON.stringify(req.body, null, 2));

    if (!territory_code || !territory_name) {
      return res.status(400).json({ success: false, message: 'Territory code and name are required' });
    }

    const result = await pool.query(
      `INSERT INTO tallac_territories 
       (territory_code, territory_name, territory_dba, territory_region, territory_state,
        territory_status, territory_email, territory_mobile, is_group, parent_territory_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        territory_code, territory_name, territory_dba || null, territory_region || null,
        territory_state || null, territory_status || 'Active', territory_email || null,
        territory_mobile || null, is_group || false, parent_territory_id || null
      ]
    );

    const territory = result.rows[0];
    console.log('Territory created with ID:', territory.id);

    // Parse zipcodes - handle both array and comma-separated string (like Vue3/Python)
    let zipcodesToAdd = [];

    if (zipcodes && Array.isArray(zipcodes)) {
      // Already an array
      zipcodesToAdd = zipcodes;
    } else if (territory_zipcodes) {
      // Parse comma-separated string (like Vue3/Python)
      const zipcodesString = territory_zipcodes.replace(/\n/g, ','); // Handle newlines
      zipcodesToAdd = zipcodesString
        .split(',')
        .map(z => z.trim())
        .filter(z => z.length > 0);
    }

    console.log('Zipcodes to add:', zipcodesToAdd);

    // Add zipcodes if provided
    if (zipcodesToAdd.length > 0) {
      // Validate that zipcodes exist in tallac_zipcodes table
      const validZipcodes = [];
      const invalidZipcodes = [];

      for (const zipcode of zipcodesToAdd) {
        const zipExistsResult = await pool.query(
          'SELECT zip_code FROM tallac_zipcodes WHERE zip_code = $1',
          [zipcode]
        );

        if (zipExistsResult.rows.length > 0) {
          validZipcodes.push(zipcode);
        } else {
          invalidZipcodes.push(zipcode);
          console.warn(`⚠ Zipcode ${zipcode} does not exist in tallac_zipcodes table`);
        }
      }

      // Insert only valid zipcodes
      for (const zipcode of validZipcodes) {
        try {
          const insertResult = await pool.query(
          `INSERT INTO territory_zipcodes (territory_id, zip_code)
           VALUES ($1, $2)
             ON CONFLICT (territory_id, zip_code) DO NOTHING
             RETURNING id`,
          [territory.id, zipcode]
        );
          if (insertResult.rows.length > 0) {
            console.log(`  ✓ Zipcode ${zipcode} added successfully`);
          } else {
            console.log(`  ⚠ Zipcode ${zipcode} already exists (skipped)`);
          }
        } catch (err) {
          console.error(`  ✗ Error adding zipcode ${zipcode}:`, err.message);
        }
      }

      if (invalidZipcodes.length > 0) {
        console.warn(`⚠ ${invalidZipcodes.length} invalid zipcodes skipped:`, invalidZipcodes);
      }

      console.log(`✓ ${validZipcodes.length} zipcodes added to territory`);
    } else {
      console.log('⚠ No zipcodes provided');
    }

    res.status(201).json({
      success: true,
      message: 'Territory created successfully',
      data: territory
    });
  } catch (error) {
    console.error('Create territory error:', error);
    res.status(500).json({ success: false, message: 'Failed to create territory', error: error.message });
  }
});

// Update territory
router.put('/:id', authenticateToken, requireRole('Corporate Admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const allowedFields = [
      'territory_code', 'territory_name', 'territory_dba', 'territory_region',
      'territory_state', 'territory_status', 'territory_email', 'territory_mobile',
      'is_group', 'parent_territory_id'
    ];

    const updateFields = [];
    const params = [];
    let paramCount = 1;

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        updateFields.push(`${field} = $${paramCount}`);
        params.push(updates[field]);
        paramCount++;
      }
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields to update' });
    }

    params.push(id);
    const result = await pool.query(
      `UPDATE tallac_territories 
       SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${paramCount}
       RETURNING *`,
      params
    );

    // Update zipcodes if provided - handle both array and comma-separated string
    let zipcodesToUpdate = null;
    
    if (updates.zipcodes && Array.isArray(updates.zipcodes)) {
      zipcodesToUpdate = updates.zipcodes;
    } else if (updates.territory_zipcodes) {
      // Parse comma-separated string (like Vue3/Python)
      const zipcodesString = updates.territory_zipcodes.replace(/\n/g, ',');
      zipcodesToUpdate = zipcodesString
        .split(',')
        .map(z => z.trim())
        .filter(z => z.length > 0);
    }

    if (zipcodesToUpdate && zipcodesToUpdate.length > 0) {
      console.log('\n=== UPDATE TERRITORY ZIPCODES ===');
      console.log('Zipcodes to update:', zipcodesToUpdate);
      
      // Validate zipcodes exist in tallac_zipcodes table
      const validZipcodes = [];
      for (const zipcode of zipcodesToUpdate) {
        const zipExistsResult = await pool.query(
          'SELECT zip_code FROM tallac_zipcodes WHERE zip_code = $1',
          [zipcode]
        );
        if (zipExistsResult.rows.length > 0) {
          validZipcodes.push(zipcode);
        } else {
          console.warn(`⚠ Zipcode ${zipcode} does not exist in tallac_zipcodes table - skipping`);
        }
      }

      // Delete existing zipcodes for this territory
      await pool.query('DELETE FROM territory_zipcodes WHERE territory_id = $1', [id]);
      
      // Add new valid zipcodes
      for (const zipcode of validZipcodes) {
        await pool.query(
          `INSERT INTO territory_zipcodes (territory_id, zip_code)
           VALUES ($1, $2)
           ON CONFLICT (territory_id, zip_code) DO NOTHING`,
          [id, zipcode]
        );
      }
      
      console.log(`✓ ${validZipcodes.length} zipcodes updated`);
    }

    res.json({
      success: true,
      message: 'Territory updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update territory error:', error);
    res.status(500).json({ success: false, message: 'Failed to update territory', error: error.message });
  }
});

// Delete territory
router.delete('/:id', authenticateToken, requireRole('Corporate Admin'), async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query('DELETE FROM tallac_territories WHERE id = $1', [id]);

    res.json({
      success: true,
      message: 'Territory deleted successfully'
    });
  } catch (error) {
    console.error('Delete territory error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete territory', error: error.message });
  }
});


// Validate zipcodes
router.post('/validate-zipcodes', authenticateToken, async (req, res) => {
  try {
    const { zipcodes } = req.body;

    if (!zipcodes) {
      return res.status(400).json({ success: false, message: 'Zipcodes are required' });
    }

    const zipcodeList = Array.isArray(zipcodes) ? zipcodes : zipcodes.split(',').map(z => z.trim());

    const result = await pool.query(
      `SELECT zip_code, city, state_name
       FROM tallac_zipcodes
       WHERE zip_code = ANY($1)`,
      [zipcodeList]
    );

    const existingSet = new Set(result.rows.map(r => r.zip_code));
    const valid = [];
    const invalid = [];

    for (const zipcode of zipcodeList) {
      if (existingSet.has(zipcode)) {
        const info = result.rows.find(r => r.zip_code === zipcode);
        valid.push({
          zipcode,
          city: info.city,
          state: info.state_name
        });
      } else {
        invalid.push(zipcode);
      }
    }

    res.json({
      success: true,
      valid,
      invalid,
      total: zipcodeList.length,
      valid_count: valid.length,
      invalid_count: invalid.length
    });
  } catch (error) {
    console.error('Validate zipcodes error:', error);
    res.status(500).json({ success: false, message: 'Failed to validate zipcodes', error: error.message });
  }
});

// Search zipcodes
router.get('/search-zipcodes', authenticateToken, async (req, res) => {
  try {
    const { query, limit = 20 } = req.query;

    if (!query) {
      return res.json({ success: true, data: [], count: 0 });
    }

    const result = await pool.query(
      `SELECT zip_code, city, county_name, state_name, state, population
       FROM tallac_zipcodes
       WHERE zip_code ILIKE $1 OR city ILIKE $1 OR state_name ILIKE $1 OR county_name ILIKE $1
       ORDER BY zip_code ASC
       LIMIT $2`,
      [`%${query}%`, parseInt(limit)]
    );

    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Search zipcodes error:', error);
    res.status(500).json({ success: false, message: 'Failed to search zipcodes', error: error.message });
  }
});

// Get territory zipcode details
router.get('/:id/zipcodes', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const zipcodesResult = await pool.query(
      `SELECT zip_code FROM territory_zipcodes WHERE territory_id = $1`,
      [id]
    );

    if (zipcodesResult.rows.length === 0) {
      return res.json({ success: true, data: [], count: 0 });
    }

    const zipcodes = zipcodesResult.rows.map(r => r.zip_code);

    const detailsResult = await pool.query(
      `SELECT zip_code, city, county_name, state_name, state, timezone, population, density
       FROM tallac_zipcodes
       WHERE zip_code = ANY($1)`,
      [zipcodes]
    );

    res.json({
      success: true,
      data: detailsResult.rows,
      count: detailsResult.rows.length
    });
  } catch (error) {
    console.error('Get territory zipcodes error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch zipcodes', error: error.message });
  }
});

export default router;

