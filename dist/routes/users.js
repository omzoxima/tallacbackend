"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const database_1 = require("../config/database");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
// Get all users (Team management)
router.get('/', auth_1.authenticateToken, (0, auth_1.requireRole)('Corporate Admin', 'Territory Admin', 'Territory Manager'), async (req, res) => {
    try {
        const { search, role, status, limit = 1000, offset = 0 } = req.query;
        let query = `
      SELECT 
        u.id, u.email, u.first_name, u.last_name, u.full_name, u.role, u.tallac_role, u.mobile_no, u.is_active,
        u.created_at, u.updated_at, u.reports_to_id,
        m.full_name as reports_to_name, m.email as reports_to_email, m.role as reports_to_role,
        COUNT(DISTINCT uta.territory_id) as territory_count,
        COUNT(DISTINCT utel.telephony_line_id) as telephony_count,
        COUNT(DISTINCT l.id) as prospect_count,
        COUNT(DISTINCT a.id) as activity_count
      FROM users u
      LEFT JOIN users m ON u.reports_to_id = m.id
      LEFT JOIN user_territory_assignments uta ON u.id = uta.user_id
      LEFT JOIN user_telephony_assignments utel ON u.id = utel.user_id
      LEFT JOIN tallac_leads l ON l.lead_owner_id = u.id
      LEFT JOIN tallac_activities a ON a.created_by_id = u.id
      WHERE 1=1
    `;
        const params = [];
        let paramCount = 1;
        if (search) {
            query += ` AND (u.email ILIKE $${paramCount} OR u.full_name ILIKE $${paramCount} OR u.first_name ILIKE $${paramCount} OR u.last_name ILIKE $${paramCount})`;
            params.push(`%${search}%`);
            paramCount++;
        }
        if (role && role !== 'all') {
            query += ` AND (u.role = $${paramCount} OR u.tallac_role = $${paramCount})`;
            params.push(role);
            paramCount++;
        }
        if (status !== undefined) {
            if (status === 'active') {
                query += ` AND u.is_active = true`;
            }
            else if (status === 'inactive') {
                query += ` AND u.is_active = false`;
            }
        }
        query += ` GROUP BY u.id, m.full_name, m.email, m.role ORDER BY u.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(limit, offset);
        const result = await database_1.pool.query(query, params);
        // Performance optimization: Fetch all territories and telephony in parallel queries instead of N+1
        const userIds = result.rows.map(u => u.id);
        const [territoriesResult, telephonyResult] = await Promise.all([
            // Get all territories for all users in one query
            userIds.length > 0 ? database_1.pool.query(`
        SELECT 
          uta.user_id,
          t.id, t.territory_name, t.territory_code, t.territory_status,
          t.territory_state, t.territory_region,
          COUNT(DISTINCT tzc.zip_code) as zipcode_count
        FROM user_territory_assignments uta
        JOIN tallac_territories t ON uta.territory_id = t.id
        LEFT JOIN territory_zip_codes tzc ON t.id = tzc.territory_id
        WHERE uta.user_id = ANY($1)
        GROUP BY uta.user_id, t.id, t.territory_name, t.territory_code, t.territory_status, t.territory_state, t.territory_region
      `, [userIds]) : Promise.resolve({ rows: [] }),
            // Get all telephony lines for all users in one query
            userIds.length > 0 ? database_1.pool.query(`
        SELECT 
          utel.user_id,
          tl.id, tl.line_name, tl.phone_number as line_number, tl.provider as carrier,
          tl.is_active as line_status, 'VoIP' as line_type
        FROM user_telephony_assignments utel
        JOIN telephony_lines tl ON utel.telephony_line_id = tl.id
        WHERE utel.user_id = ANY($1)
      `, [userIds]) : Promise.resolve({ rows: [] })
        ]);
        // Group territories and telephony by user_id
        const territoriesByUserId = {};
        territoriesResult.rows.forEach((t) => {
            if (!territoriesByUserId[t.user_id]) {
                territoriesByUserId[t.user_id] = [];
            }
            territoriesByUserId[t.user_id].push({
                territory: t.id,
                territory_name: t.territory_name,
                territory_code: t.territory_code,
                territory_status: t.territory_status,
                territory_state: t.territory_state,
                territory_region: t.territory_region,
                zipcode_count: parseInt(t.zipcode_count) || 0
            });
        });
        const telephonyByUserId = {};
        telephonyResult.rows.forEach((tl) => {
            if (!telephonyByUserId[tl.user_id]) {
                telephonyByUserId[tl.user_id] = [];
            }
            telephonyByUserId[tl.user_id].push({
                line_number: tl.line_number,
                line_status: tl.line_status ? 'Active' : 'Inactive',
                line_type: tl.line_type,
                carrier: tl.carrier
            });
        });
        // Map users with their territories and telephony
        const usersWithDetails = result.rows.map((user) => ({
            ...user,
            name: user.email, // Use email as name for compatibility
            status: user.is_active ? 'Active' : 'Inactive', // Add status field for Vue3 compatibility
            territories: territoriesByUserId[user.id] || [],
            telephony_lines: telephonyByUserId[user.id] || [],
            territory_count: parseInt(user.territory_count) || 0,
            telephony_count: parseInt(user.telephony_count) || 0,
            prospect_count: parseInt(user.prospect_count) || 0,
            activity_count: parseInt(user.activity_count) || 0
        }));
        res.json(usersWithDetails);
    }
    catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get user by ID
router.get('/:id', auth_1.authenticateToken, (0, auth_1.requireRole)('Corporate Admin', 'Territory Admin', 'Territory Manager'), async (req, res) => {
    try {
        const { id } = req.params;
        const result = await database_1.pool.query(`SELECT 
        u.id, u.email, u.first_name, u.last_name, u.full_name, u.role, u.is_active,
        u.created_at, u.updated_at, u.reports_to_id,
        m.full_name as reports_to_name, m.email as reports_to_email
      FROM users u
      LEFT JOIN users m ON u.reports_to_id = m.id
      WHERE u.id = $1`, [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(result.rows[0]);
    }
    catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Create user (Corporate Admin, Territory Admin only)
router.post('/', auth_1.authenticateToken, (0, auth_1.requireRole)('Corporate Admin', 'Territory Admin'), async (req, res) => {
    const client = await database_1.pool.connect();
    try {
        await client.query('BEGIN');
        const { email, first_name, last_name, full_name, role, tallac_role, mobile_no, is_active, reports_to_id, password, territories = [], telephony } = req.body;
        if (!email) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Email is required' });
        }
        // Check if user exists
        const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'User already exists' });
        }
        // Default password is 12345, require password change on first login
        const defaultPassword = password || '12345';
        const passwordHash = await bcryptjs_1.default.hash(defaultPassword, 10);
        const trimmedFirstName = first_name?.trim();
        const trimmedLastName = last_name?.trim();
        const computedFullName = (full_name?.trim()) || (trimmedFirstName && trimmedLastName ? `${trimmedFirstName} ${trimmedLastName}` : trimmedFirstName || trimmedLastName || email);
        const safeFirstName = trimmedFirstName || computedFullName?.split(' ')[0] || email;
        const safeLastName = trimmedLastName || (computedFullName?.split(' ').slice(1).join(' ').trim() || '') || '';
        const userRole = role || tallac_role || 'Sales User';
        const isActiveValue = is_active !== undefined ? is_active : true;
        const tallacRoleValue = tallac_role || userRole;
        // Insert user
        const userResult = await client.query(`INSERT INTO users (
        email, first_name, last_name, full_name, role, tallac_role, mobile_no, is_active, password_hash,
        password_change_required, reports_to_id, "firstName", "lastName", active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING id, email, first_name, last_name, full_name, role, tallac_role, mobile_no, is_active, created_at`, [
            email,
            safeFirstName,
            safeLastName,
            computedFullName,
            userRole,
            tallacRoleValue,
            mobile_no || null,
            isActiveValue,
            passwordHash,
            true, // Require password change on first login
            reports_to_id || null,
            safeFirstName,
            safeLastName,
            isActiveValue
        ]);
        const userId = userResult.rows[0].id;
        // Assign territories if provided
        if (Array.isArray(territories) && territories.length > 0) {
            for (const territoryId of territories) {
                // Check if territory exists
                const territoryCheck = await client.query('SELECT id FROM tallac_territories WHERE id::text = $1 OR territory_name = $1', [territoryId]);
                if (territoryCheck.rows.length > 0) {
                    const actualTerritoryId = territoryCheck.rows[0].id;
                    await client.query(`INSERT INTO user_territory_assignments (user_id, territory_id)
             VALUES ($1, $2)
             ON CONFLICT (user_id, territory_id) DO NOTHING`, [userId, actualTerritoryId]);
                }
            }
        }
        // Create and assign telephony line if provided
        if (telephony && telephony.phone_number && telephony.line_type) {
            // Create telephony line
            const telephonyResult = await client.query(`INSERT INTO telephony_lines (line_name, phone_number, provider, is_active)
         VALUES ($1, $2, $3, $4)
         RETURNING id`, [
                `Line for ${email}`,
                telephony.phone_number,
                telephony.carrier || null,
                true
            ]);
            const telephonyLineId = telephonyResult.rows[0].id;
            // Assign to user
            await client.query(`INSERT INTO user_telephony_assignments (user_id, telephony_line_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, telephony_line_id) DO NOTHING`, [userId, telephonyLineId]);
        }
        await client.query('COMMIT');
        // Fetch complete user data with territories and telephony
        const completeUser = await database_1.pool.query(`SELECT 
        u.id, u.email, u.first_name, u.last_name, u.full_name, u.role, u.tallac_role, u.mobile_no, u.is_active,
        u.created_at, u.updated_at, u.reports_to_id,
        COUNT(DISTINCT uta.territory_id) as territory_count,
        COUNT(DISTINCT utel.telephony_line_id) as telephony_count
      FROM users u
      LEFT JOIN user_territory_assignments uta ON u.id = uta.user_id
      LEFT JOIN user_telephony_assignments utel ON u.id = utel.user_id
      WHERE u.id = $1
      GROUP BY u.id`, [userId]);
        res.status(201).json(completeUser.rows[0]);
    }
    catch (error) {
        await client.query('ROLLBACK');
        console.error('Error creating user:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(400).json({ error: 'User already exists' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
    finally {
        client.release();
    }
});
// Update user (Corporate Admin, Territory Admin only)
router.put('/:id', auth_1.authenticateToken, (0, auth_1.requireRole)('Corporate Admin', 'Territory Admin'), async (req, res) => {
    const client = await database_1.pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const { email, first_name, last_name, full_name, role, tallac_role, mobile_no, is_active, reports_to_id, territories = [], telephony } = req.body;
        // Check if user exists
        const existing = await client.query('SELECT id FROM users WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'User not found' });
        }
        // Check if email already exists (excluding current user)
        if (email) {
            const emailCheck = await client.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, id]);
            if (emailCheck.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Email already exists' });
            }
        }
        const trimmedFirstName = typeof first_name === 'string' ? first_name.trim() : undefined;
        const trimmedLastName = typeof last_name === 'string' ? last_name.trim() : undefined;
        const computedFullName = (full_name?.trim()) || (trimmedFirstName && trimmedLastName ? `${trimmedFirstName} ${trimmedLastName}` : undefined);
        const safeFirstName = trimmedFirstName;
        const safeLastName = trimmedLastName;
        const userRole = role || tallac_role;
        const tallacRoleValue = tallac_role || role || undefined;
        const isActiveValue = typeof is_active === 'boolean' ? is_active : undefined;
        // Update user
        const result = await client.query(`UPDATE users SET
        email = COALESCE($1, email),
        first_name = COALESCE($2, first_name),
        last_name = COALESCE($3, last_name),
        full_name = COALESCE($4, full_name),
        role = COALESCE($5, role),
        tallac_role = COALESCE($6, tallac_role),
        mobile_no = COALESCE($7, mobile_no),
        is_active = COALESCE($8, is_active),
        reports_to_id = COALESCE($9, reports_to_id),
        "firstName" = COALESCE($11, "firstName"),
        "lastName" = COALESCE($12, "lastName"),
        active = COALESCE($13, active),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $10
      RETURNING id, email, first_name, last_name, full_name, role, tallac_role, mobile_no, is_active, created_at, updated_at`, [
            email,
            safeFirstName || null,
            safeLastName || null,
            computedFullName || null,
            userRole,
            tallacRoleValue,
            mobile_no,
            isActiveValue,
            reports_to_id,
            id,
            safeFirstName || null,
            safeLastName || null,
            isActiveValue
        ]);
        // Update territories if provided
        if (Array.isArray(territories)) {
            // Remove existing assignments
            await client.query('DELETE FROM user_territory_assignments WHERE user_id = $1', [id]);
            // Add new assignments
            if (territories.length > 0) {
                for (const territoryId of territories) {
                    const territoryCheck = await client.query('SELECT id FROM tallac_territories WHERE id::text = $1 OR territory_name = $1', [territoryId]);
                    if (territoryCheck.rows.length > 0) {
                        const actualTerritoryId = territoryCheck.rows[0].id;
                        await client.query(`INSERT INTO user_territory_assignments (user_id, territory_id)
               VALUES ($1, $2)
               ON CONFLICT (user_id, territory_id) DO NOTHING`, [id, actualTerritoryId]);
                    }
                }
            }
        }
        // Update telephony if provided
        if (telephony && telephony.phone_number && telephony.line_type) {
            // Check if user already has a telephony line assigned
            const existingTelephony = await client.query('SELECT telephony_line_id FROM user_telephony_assignments WHERE user_id = $1 LIMIT 1', [id]);
            if (existingTelephony.rows.length > 0) {
                // Update existing telephony line
                await client.query(`UPDATE telephony_lines SET
            phone_number = $1,
            provider = COALESCE($2, provider),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $3`, [telephony.phone_number, telephony.carrier, existingTelephony.rows[0].telephony_line_id]);
            }
            else {
                // Create new telephony line
                const telephonyResult = await client.query(`INSERT INTO telephony_lines (line_name, phone_number, provider, is_active)
           VALUES ($1, $2, $3, $4)
           RETURNING id`, [
                    `Line for ${result.rows[0].email}`,
                    telephony.phone_number,
                    telephony.carrier || null,
                    true
                ]);
                const telephonyLineId = telephonyResult.rows[0].id;
                // Assign to user
                await client.query(`INSERT INTO user_telephony_assignments (user_id, telephony_line_id)
           VALUES ($1, $2)
           ON CONFLICT (user_id, telephony_line_id) DO NOTHING`, [id, telephonyLineId]);
            }
        }
        await client.query('COMMIT');
        // Fetch complete user data
        const completeUser = await database_1.pool.query(`SELECT 
        u.id, u.email, u.first_name, u.last_name, u.full_name, u.role, u.tallac_role, u.mobile_no, u.is_active,
        u.created_at, u.updated_at, u.reports_to_id,
        COUNT(DISTINCT uta.territory_id) as territory_count,
        COUNT(DISTINCT utel.telephony_line_id) as telephony_count
      FROM users u
      LEFT JOIN user_territory_assignments uta ON u.id = uta.user_id
      LEFT JOIN user_telephony_assignments utel ON u.id = utel.user_id
      WHERE u.id = $1
      GROUP BY u.id`, [id]);
        res.json(completeUser.rows[0]);
    }
    catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating user:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(400).json({ error: 'Email already exists' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
    finally {
        client.release();
    }
});
// Delete user (Corporate Admin only)
router.delete('/:id', auth_1.authenticateToken, (0, auth_1.requireRole)('Corporate Admin'), async (req, res) => {
    try {
        const { id } = req.params;
        // Prevent deleting yourself
        if (req.user?.userId === id) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }
        const result = await database_1.pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ message: 'User deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
//# sourceMappingURL=users.js.map