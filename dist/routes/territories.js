"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const database_1 = require("../config/database");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
const zipCodePattern = /^\d{5}$/;
// Get all territories with owners and zip codes
router.get('/', auth_1.authenticateToken, async (req, res) => {
    try {
        const { search, status } = req.query;
        let query = 'SELECT * FROM tallac_territories WHERE 1=1';
        const params = [];
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
        const result = await database_1.pool.query(query, params);
        // Fetch owners, zip codes, partners, and counts for each territory
        const territories = await Promise.all(result.rows.map(async (territory) => {
            const ownersResult = await database_1.pool.query('SELECT * FROM territory_owners WHERE territory_id = $1 ORDER BY owner_name', [territory.id]);
            const zipCodesResult = await database_1.pool.query('SELECT * FROM territory_zip_codes WHERE territory_id = $1 ORDER BY zip_code', [territory.id]);
            // Get partners for this territory
            const partnersResult = await database_1.pool.query(`
          SELECT 
            p.id,
            p.name,
            p.partner_name,
            p.partner_code,
            p.partner_address as address,
            COALESCE(pt.is_primary, false) as is_primary
          FROM partner_territories pt
          JOIN tallac_partners p ON pt.partner_id = p.id
          WHERE pt.territory_id = $1
          ORDER BY COALESCE(pt.is_primary, false) DESC, p.partner_name
        `, [territory.id]);
            // Map territory fields to match frontend expectations
            return {
                ...territory,
                name: territory.name || territory.id, // For compatibility
                territory_dba: territory.territory_dba || territory.doing_business_as,
                territory_status: territory.territory_status || territory.status || 'Active',
                territory_code: territory.territory_code || '',
                territory_region: territory.territory_region || '',
                territory_state: territory.territory_state || '',
                zipcode_count: zipCodesResult.rows.length,
                owners: ownersResult.rows,
                zip_codes: zipCodesResult.rows,
                partners: partnersResult.rows.map(p => ({
                    name: p.name,
                    partner_name: p.partner_name,
                    partner_code: p.partner_code,
                    address: p.address,
                    is_primary: p.is_primary || false
                }))
            };
        }));
        res.json(territories);
    }
    catch (error) {
        console.error('Error fetching territories:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get single territory with owners and zip codes
router.get('/:id', auth_1.authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await database_1.pool.query('SELECT * FROM tallac_territories WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Territory not found' });
        }
        const territory = result.rows[0];
        // Fetch owners and zip codes
        const ownersResult = await database_1.pool.query('SELECT * FROM territory_owners WHERE territory_id = $1 ORDER BY owner_name', [id]);
        const zipCodesResult = await database_1.pool.query('SELECT * FROM territory_zip_codes WHERE territory_id = $1 ORDER BY zip_code', [id]);
        res.json({
            ...territory,
            owners: ownersResult.rows,
            zip_codes: zipCodesResult.rows
        });
    }
    catch (error) {
        console.error('Error fetching territory:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Create territory (Corporate Admin, Territory Admin only)
router.post('/', auth_1.authenticateToken, (0, auth_1.requireRole)('Corporate Admin', 'Territory Admin'), async (req, res) => {
    try {
        const { territory_name, doing_business_as, status, territory_owner, mobile, address, territory_manager_email, email, map_address, owners, zip_codes, territory_code, territory_region, territory_state, territory_status, territory_email, territory_mobile } = req.body;
        if (!territory_name) {
            return res.status(400).json({ error: 'Territory name is required' });
        }
        // Check if territory name already exists
        const existing = await database_1.pool.query('SELECT id FROM tallac_territories WHERE territory_name = $1', [territory_name]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Territory name already exists. Select another name' });
        }
        const normalizedZipCodes = Array.isArray(zip_codes)
            ? zip_codes
                .map((z) => ({
                zip_code: (z.zip_code || '').trim(),
                city: (z.city || '').trim(),
                state: (z.state || territory_state || '').trim(),
            }))
                .filter((z) => z.zip_code)
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
        const result = await database_1.pool.query(`INSERT INTO tallac_territories (
        territory_name, doing_business_as, status,
        territory_owner, mobile, address, territory_manager_email, email, map_address,
        territory_code, territory_region, territory_state, territory_status, territory_email, territory_mobile
      ) VALUES (
        $1, $2, $3,
        $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15
      )
      RETURNING *`, [
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
        ]);
        const territory = result.rows[0];
        // Add owners if provided
        if (owners && Array.isArray(owners)) {
            for (const owner of owners) {
                if (owner.owner_name) {
                    await database_1.pool.query('INSERT INTO territory_owners (territory_id, owner_name, owner_email, owner_phone) VALUES ($1, $2, $3, $4)', [territory.id, owner.owner_name, owner.owner_email || null, owner.owner_phone || null]);
                }
            }
        }
        // Add zip codes if provided
        for (const zipCode of normalizedZipCodes) {
            await database_1.pool.query(`INSERT INTO territory_zip_codes (territory_id, zip_code, city, state)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (territory_id, zip_code) DO NOTHING`, [territory.id, zipCode.zip_code, zipCode.city || null, zipCode.state || null]);
        }
        // Fetch the complete territory with owners and zip codes
        const ownersResult = await database_1.pool.query('SELECT * FROM territory_owners WHERE territory_id = $1 ORDER BY owner_name', [territory.id]);
        const zipCodesResult = await database_1.pool.query('SELECT * FROM territory_zip_codes WHERE territory_id = $1 ORDER BY zip_code', [territory.id]);
        res.status(201).json({
            ...territory,
            owners: ownersResult.rows,
            zip_codes: zipCodesResult.rows
        });
    }
    catch (error) {
        console.error('Error creating territory:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(400).json({ error: 'Territory name already exists. Select another name' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Update territory (Corporate Admin, Territory Admin only)
router.put('/:id', auth_1.authenticateToken, (0, auth_1.requireRole)('Corporate Admin', 'Territory Admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { territory_name, doing_business_as, status, territory_owner, mobile, address, territory_manager_email, email, map_address, owners, zip_codes, territory_code, territory_region, territory_state, territory_status, territory_email, territory_mobile } = req.body;
        // Check if territory exists
        const existing = await database_1.pool.query('SELECT id FROM tallac_territories WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Territory not found' });
        }
        // Check if territory name already exists (excluding current territory)
        if (territory_name) {
            const nameCheck = await database_1.pool.query('SELECT id FROM tallac_territories WHERE territory_name = $1 AND id != $2', [territory_name, id]);
            if (nameCheck.rows.length > 0) {
                return res.status(400).json({ error: 'Territory name already exists. Select another name' });
            }
        }
        // Update territory
        const result = await database_1.pool.query(`UPDATE tallac_territories SET
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
      RETURNING *`, [
            territory_name, doing_business_as, status,
            territory_owner, mobile, address, territory_manager_email, email, map_address,
            territory_code, territory_region, territory_state, territory_status || status,
            territory_email, territory_mobile, id
        ]);
        // Update owners if provided
        if (owners !== undefined) {
            // Delete existing owners
            await database_1.pool.query('DELETE FROM territory_owners WHERE territory_id = $1', [id]);
            // Add new owners
            if (Array.isArray(owners)) {
                for (const owner of owners) {
                    if (owner.owner_name) {
                        await database_1.pool.query('INSERT INTO territory_owners (territory_id, owner_name, owner_email, owner_phone) VALUES ($1, $2, $3, $4)', [id, owner.owner_name, owner.owner_email || null, owner.owner_phone || null]);
                    }
                }
            }
        }
        // Update zip codes if provided
        if (zip_codes !== undefined) {
            const normalizedZipCodes = Array.isArray(zip_codes)
                ? zip_codes
                    .map((z) => ({
                    zip_code: (z.zip_code || '').trim(),
                    city: (z.city || '').trim(),
                    state: (z.state || territory_state || '').trim(),
                }))
                    .filter((z) => z.zip_code)
                : [];
            for (const zip of normalizedZipCodes) {
                if (!zipCodePattern.test(zip.zip_code)) {
                    return res.status(400).json({ error: `Invalid ZIP code: ${zip.zip_code}` });
                }
            }
            // Delete existing zip codes
            await database_1.pool.query('DELETE FROM territory_zip_codes WHERE territory_id = $1', [id]);
            // Add new zip codes
            for (const zipCode of normalizedZipCodes) {
                await database_1.pool.query(`INSERT INTO territory_zip_codes (territory_id, zip_code, city, state)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (territory_id, zip_code) DO NOTHING`, [id, zipCode.zip_code, zipCode.city || null, zipCode.state || null]);
            }
        }
        // Fetch the complete territory with owners and zip codes
        const ownersResult = await database_1.pool.query('SELECT * FROM territory_owners WHERE territory_id = $1 ORDER BY owner_name', [id]);
        const zipCodesResult = await database_1.pool.query('SELECT * FROM territory_zip_codes WHERE territory_id = $1 ORDER BY zip_code', [id]);
        res.json({
            ...result.rows[0],
            owners: ownersResult.rows,
            zip_codes: zipCodesResult.rows
        });
    }
    catch (error) {
        console.error('Error updating territory:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(400).json({ error: 'Territory name already exists. Select another name' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Delete territory (Corporate Admin only)
router.delete('/:id', auth_1.authenticateToken, (0, auth_1.requireRole)('Corporate Admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const result = await database_1.pool.query('DELETE FROM tallac_territories WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Territory not found' });
        }
        res.json({ message: 'Territory deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting territory:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
//# sourceMappingURL=territories.js.map