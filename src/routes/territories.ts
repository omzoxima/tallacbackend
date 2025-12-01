import express from 'express';
import { pool } from '../config/database';
import { authenticateToken, requireRole, AuthRequest } from '../middleware/auth';

const router = express.Router();
const zipCodePattern = /^\d{5}$/;

// Get all territories with owners and zip codes
// Allow without auth for search functionality in modals
router.get('/', async (req: express.Request, res: express.Response) => {
  try {
    const { search, status } = req.query;

    let query = 'SELECT * FROM tallac_territories WHERE 1=1';
    const params: any[] = [];
    let paramCount = 1;

    if (search) {
      query += ` AND (territory_name ILIKE $${paramCount} OR doing_business_as ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }

    if (status && status !== 'all') {
      query += ` AND status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    query += ' ORDER BY territory_name';

    const result = await pool.query(query, params);

    // Performance optimization: Fetch all owners, zip codes, and partners in parallel queries instead of N+1
    const territoryIds = result.rows.map(t => t.id);
    
    const [ownersResult, zipCodesResult, partnersResult] = await Promise.all([
      // Get all owners for all territories in one query
      territoryIds.length > 0 ? pool.query(
        'SELECT * FROM territory_owners WHERE territory_id = ANY($1) ORDER BY territory_id, owner_name',
        [territoryIds]
      ) : Promise.resolve({ rows: [] }),
      
      // Get all zip codes for all territories in one query
      territoryIds.length > 0 ? pool.query(
        'SELECT * FROM territory_zip_codes WHERE territory_id = ANY($1) ORDER BY territory_id, zip_code',
        [territoryIds]
      ) : Promise.resolve({ rows: [] }),
      
      // Get all partners for all territories in one query
      territoryIds.length > 0 ? pool.query(`
        SELECT 
          pt.territory_id,
          p.id,
          p.name,
          p.partner_name,
          p.partner_code,
          p.partner_address as address,
          COALESCE(pt.is_primary, false) as is_primary
        FROM partner_territories pt
        JOIN tallac_partners p ON pt.partner_id = p.id
        WHERE pt.territory_id = ANY($1)
        ORDER BY pt.territory_id, COALESCE(pt.is_primary, false) DESC, p.partner_name
      `, [territoryIds]) : Promise.resolve({ rows: [] })
    ]);
    
    // Group owners, zip codes, and partners by territory_id
    const ownersByTerritoryId: Record<string, any[]> = {};
    ownersResult.rows.forEach((o: any) => {
      if (!ownersByTerritoryId[o.territory_id]) {
        ownersByTerritoryId[o.territory_id] = [];
      }
      ownersByTerritoryId[o.territory_id].push(o);
    });
    
    const zipCodesByTerritoryId: Record<string, any[]> = {};
    zipCodesResult.rows.forEach((zc: any) => {
      if (!zipCodesByTerritoryId[zc.territory_id]) {
        zipCodesByTerritoryId[zc.territory_id] = [];
      }
      zipCodesByTerritoryId[zc.territory_id].push(zc);
    });
    
    const partnersByTerritoryId: Record<string, any[]> = {};
    partnersResult.rows.forEach((p: any) => {
      if (!partnersByTerritoryId[p.territory_id]) {
        partnersByTerritoryId[p.territory_id] = [];
      }
      partnersByTerritoryId[p.territory_id].push({
        name: p.name,
        partner_name: p.partner_name,
        partner_code: p.partner_code,
        address: p.address,
        is_primary: p.is_primary || false
      });
    });
    
    // Map territories with their owners, zip codes, and partners
    const territories = result.rows.map((territory) => {
      const owners = ownersByTerritoryId[territory.id] || [];
      const zipCodes = zipCodesByTerritoryId[territory.id] || [];
      const partners = partnersByTerritoryId[territory.id] || [];
      
      return {
        ...territory,
        name: territory.name || territory.id, // For compatibility
        territory_dba: territory.territory_dba || territory.doing_business_as,
        territory_status: territory.territory_status || territory.status || 'Active',
        territory_code: territory.territory_code || '',
        territory_region: territory.territory_region || '',
        territory_state: territory.territory_state || '',
        zipcode_count: zipCodes.length,
        owners,
        zip_codes: zipCodes,
        partners
      };
    });

    res.json(territories);
  } catch (error) {
    console.error('Error fetching territories:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single territory with owners and zip codes
router.get('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT * FROM tallac_territories WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Territory not found' });
    }

    const territory = result.rows[0];

    // Performance optimization: Fetch owners and zip codes in parallel
    const [ownersResult, zipCodesResult] = await Promise.all([
      pool.query(
        'SELECT * FROM territory_owners WHERE territory_id = $1 ORDER BY owner_name',
        [id]
      ),
      pool.query(
        'SELECT * FROM territory_zip_codes WHERE territory_id = $1 ORDER BY zip_code',
        [id]
      )
    ]);

    res.json({
      ...territory,
      owners: ownersResult.rows,
      zip_codes: zipCodesResult.rows
    });
  } catch (error) {
    console.error('Error fetching territory:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create territory (Corporate Admin, Territory Admin only)
router.post('/', authenticateToken, requireRole('Corporate Admin', 'Territory Admin'), async (req: AuthRequest, res) => {
  try {
    const {
      territory_name,
      doing_business_as,
      status,
      territory_owner,
      mobile,
      address,
      territory_manager_email,
      email,
      map_address,
      owners,
      zip_codes,
      territory_code,
      territory_region,
      territory_state,
      territory_status,
      territory_email,
      territory_mobile
    } = req.body;

    if (!territory_name) {
      return res.status(400).json({ error: 'Territory name is required' });
    }

    // Check if territory name already exists
    const existing = await pool.query(
      'SELECT id FROM tallac_territories WHERE territory_name = $1',
      [territory_name]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Territory name already exists. Select another name' });
    }

    const normalizedZipCodes = Array.isArray(zip_codes)
      ? zip_codes
          .map((z: any) => ({
            zip_code: (z.zip_code || '').trim(),
            city: (z.city || '').trim(),
            state: (z.state || territory_state || '').trim(),
          }))
          .filter((z: any) => z.zip_code)
      : [];

    if (normalizedZipCodes.length === 0) {
      return res.status(400).json({ error: 'At least one ZIP code is required' });
    }

    for (const zip of normalizedZipCodes) {
      if (!zipCodePattern.test(zip.zip_code)) {
        return res.status(400).json({ error: `Invalid ZIP code: ${zip.zip_code}` });
      }
    }

    // Create territory
    const result = await pool.query(
      `INSERT INTO tallac_territories (
        territory_name, doing_business_as, status,
        territory_owner, mobile, address, territory_manager_email, email, map_address,
        territory_code, territory_region, territory_state, territory_status, territory_email, territory_mobile
      ) VALUES (
        $1, $2, $3,
        $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15
      )
      RETURNING *`,
      [
        territory_name,
        doing_business_as,
        status || 'Active',
        territory_owner,
        mobile,
        address,
        territory_manager_email,
        email,
        map_address,
        territory_code || null,
        territory_region || null,
        territory_state || null,
        territory_status || status || 'Active',
        territory_email || null,
        territory_mobile || null
      ]
    );

    const territory = result.rows[0];

    // Add owners if provided
    if (owners && Array.isArray(owners)) {
      for (const owner of owners) {
        if (owner.owner_name) {
          await pool.query(
            'INSERT INTO territory_owners (territory_id, owner_name, owner_email, owner_phone) VALUES ($1, $2, $3, $4)',
            [territory.id, owner.owner_name, owner.owner_email || null, owner.owner_phone || null]
          );
        }
      }
    }

    // Add zip codes if provided
    for (const zipCode of normalizedZipCodes) {
      await pool.query(
        `INSERT INTO territory_zip_codes (territory_id, zip_code, city, state)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (territory_id, zip_code) DO NOTHING`,
        [territory.id, zipCode.zip_code, zipCode.city || null, zipCode.state || null]
      );
    }

    // Fetch the complete territory with owners and zip codes
    const ownersResult = await pool.query(
      'SELECT * FROM territory_owners WHERE territory_id = $1 ORDER BY owner_name',
      [territory.id]
    );
    const zipCodesResult = await pool.query(
      'SELECT * FROM territory_zip_codes WHERE territory_id = $1 ORDER BY zip_code',
      [territory.id]
    );

    res.status(201).json({
      ...territory,
      owners: ownersResult.rows,
      zip_codes: zipCodesResult.rows
    });
  } catch (error: any) {
    console.error('Error creating territory:', error);
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'Territory name already exists. Select another name' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update territory (Corporate Admin, Territory Admin only)
router.put('/:id', authenticateToken, requireRole('Corporate Admin', 'Territory Admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const {
      territory_name,
      doing_business_as,
      status,
      territory_owner,
      mobile,
      address,
      territory_manager_email,
      email,
      map_address,
      owners,
      zip_codes,
      territory_code,
      territory_region,
      territory_state,
      territory_status,
      territory_email,
      territory_mobile
    } = req.body;

    // Check if territory exists
    const existing = await pool.query('SELECT id FROM tallac_territories WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Territory not found' });
    }

    // Check if territory name already exists (excluding current territory)
    if (territory_name) {
      const nameCheck = await pool.query(
        'SELECT id FROM tallac_territories WHERE territory_name = $1 AND id != $2',
        [territory_name, id]
      );
      if (nameCheck.rows.length > 0) {
        return res.status(400).json({ error: 'Territory name already exists. Select another name' });
      }
    }

    // Update territory
    const result = await pool.query(
      `UPDATE tallac_territories SET
        territory_name = COALESCE($1, territory_name),
        doing_business_as = COALESCE($2, doing_business_as),
        status = COALESCE($3, status),
        territory_owner = COALESCE($4, territory_owner),
        mobile = COALESCE($5, mobile),
        address = COALESCE($6, address),
        territory_manager_email = COALESCE($7, territory_manager_email),
        email = COALESCE($8, email),
        map_address = COALESCE($9, map_address),
        territory_code = COALESCE($10, territory_code),
        territory_region = COALESCE($11, territory_region),
        territory_state = COALESCE($12, territory_state),
        territory_status = COALESCE($13, territory_status),
        territory_email = COALESCE($14, territory_email),
        territory_mobile = COALESCE($15, territory_mobile),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $16
      RETURNING *`,
      [
        territory_name, doing_business_as, status,
        territory_owner, mobile, address, territory_manager_email, email, map_address,
        territory_code, territory_region, territory_state, territory_status || status,
        territory_email, territory_mobile, id
      ]
    );

    // Update owners if provided
    if (owners !== undefined) {
      // Delete existing owners
      await pool.query('DELETE FROM territory_owners WHERE territory_id = $1', [id]);
      // Add new owners
      if (Array.isArray(owners)) {
        for (const owner of owners) {
          if (owner.owner_name) {
            await pool.query(
              'INSERT INTO territory_owners (territory_id, owner_name, owner_email, owner_phone) VALUES ($1, $2, $3, $4)',
              [id, owner.owner_name, owner.owner_email || null, owner.owner_phone || null]
            );
          }
        }
      }
    }

    // Update zip codes if provided
    if (zip_codes !== undefined) {
      const normalizedZipCodes = Array.isArray(zip_codes)
        ? zip_codes
            .map((z: any) => ({
              zip_code: (z.zip_code || '').trim(),
              city: (z.city || '').trim(),
              state: (z.state || territory_state || '').trim(),
            }))
            .filter((z: any) => z.zip_code)
        : [];

      for (const zip of normalizedZipCodes) {
        if (!zipCodePattern.test(zip.zip_code)) {
          return res.status(400).json({ error: `Invalid ZIP code: ${zip.zip_code}` });
        }
      }

      // Delete existing zip codes
      await pool.query('DELETE FROM territory_zip_codes WHERE territory_id = $1', [id]);
      // Add new zip codes
      for (const zipCode of normalizedZipCodes) {
        await pool.query(
          `INSERT INTO territory_zip_codes (territory_id, zip_code, city, state)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (territory_id, zip_code) DO NOTHING`,
          [id, zipCode.zip_code, zipCode.city || null, zipCode.state || null]
        );
      }
    }

    // Fetch the complete territory with owners and zip codes
    const ownersResult = await pool.query(
      'SELECT * FROM territory_owners WHERE territory_id = $1 ORDER BY owner_name',
      [id]
    );
    const zipCodesResult = await pool.query(
      'SELECT * FROM territory_zip_codes WHERE territory_id = $1 ORDER BY zip_code',
      [id]
    );

    res.json({
      ...result.rows[0],
      owners: ownersResult.rows,
      zip_codes: zipCodesResult.rows
    });
  } catch (error: any) {
    console.error('Error updating territory:', error);
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'Territory name already exists. Select another name' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete territory (Corporate Admin only)
router.delete('/:id', authenticateToken, requireRole('Corporate Admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM tallac_territories WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Territory not found' });
    }

    res.json({ message: 'Territory deleted successfully' });
  } catch (error) {
    console.error('Error deleting territory:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

