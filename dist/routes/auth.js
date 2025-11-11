"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const database_1 = require("../config/database");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
// Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        const result = await database_1.pool.query('SELECT * FROM users WHERE email = $1 AND is_active = true', [email]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const user = result.rows[0];
        const isValidPassword = await bcryptjs_1.default.compare(password, user.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        // Check if user is using default password (12345)
        // If the provided password is "12345" and it matches the hash, force password change
        const DEFAULT_PASSWORD = '12345';
        const isDefaultPassword = password === DEFAULT_PASSWORD;
        // If user is using default password, force password change
        let passwordChangeRequired = false;
        if (isDefaultPassword) {
            // Set password_change_required to true if using default password
            await database_1.pool.query('UPDATE users SET password_change_required = true WHERE id = $1', [user.id]);
            passwordChangeRequired = true;
        }
        else {
            // Check if password_change_required flag is already set
            // If null, set it to false for existing users (they've changed password)
            if (user.password_change_required === null) {
                await database_1.pool.query('UPDATE users SET password_change_required = false WHERE id = $1', [user.id]);
                passwordChangeRequired = false;
            }
            else {
                passwordChangeRequired = user.password_change_required || false;
            }
        }
        const token = jsonwebtoken_1.default.sign({ userId: user.id, email: user.email, role: user.role, passwordChangeRequired }, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '7d' });
        res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                role: user.role,
                password_change_required: passwordChangeRequired,
            },
        });
    }
    catch (error) {
        console.error('Error during login:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Register (for development/testing)
router.post('/register', async (req, res) => {
    try {
        const { email, password, full_name, role = 'Sales User' } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        // Check if user exists
        const existingUser = await database_1.pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'User already exists' });
        }
        const passwordHash = await bcryptjs_1.default.hash(password, 10);
        const result = await database_1.pool.query(`INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, full_name, role`, [email, passwordHash, full_name || email, role]);
        res.status(201).json({ user: result.rows[0] });
    }
    catch (error) {
        console.error('Error during registration:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get current user info
router.get('/me', auth_1.authenticateToken, async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        const result = await database_1.pool.query('SELECT id, email, full_name, role, password_change_required, is_active FROM users WHERE id = $1', [req.user.userId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ user: result.rows[0] });
    }
    catch (error) {
        console.error('Error fetching user info:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Change password
router.post('/change-password', auth_1.authenticateToken, async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        const { current_password, new_password } = req.body;
        // Get user to check if password change is required
        const userResult = await database_1.pool.query('SELECT id, password_hash, password_change_required FROM users WHERE id = $1', [req.user.userId]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        const user = userResult.rows[0];
        const passwordChangeRequired = user.password_change_required || false;
        // Validate new password
        if (!new_password) {
            return res.status(400).json({ error: 'New password is required' });
        }
        if (new_password.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters long' });
        }
        // Prevent using default password
        const DEFAULT_PASSWORD = '12345';
        if (new_password === DEFAULT_PASSWORD) {
            return res.status(400).json({ error: 'New password cannot be the default password. Please choose a different password.' });
        }
        // Verify current password (skip if password change is required - first time login)
        if (!passwordChangeRequired) {
            if (!current_password) {
                return res.status(400).json({ error: 'Current password is required' });
            }
            const isValidPassword = await bcryptjs_1.default.compare(current_password, user.password_hash);
            if (!isValidPassword) {
                return res.status(401).json({ error: 'Current password is incorrect' });
            }
        }
        // Hash new password
        const passwordHash = await bcryptjs_1.default.hash(new_password, 10);
        // Update password and clear password_change_required flag
        await database_1.pool.query(`UPDATE users SET 
        password_hash = $1, 
        password_change_required = false,
        last_password_change = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2`, [passwordHash, req.user.userId]);
        res.json({ message: 'Password changed successfully' });
    }
    catch (error) {
        console.error('Error changing password:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Logout (client-side mainly, but we can invalidate tokens if needed)
router.post('/logout', auth_1.authenticateToken, async (req, res) => {
    try {
        // In a production app, you might want to maintain a token blacklist
        // For now, we'll just return success and let the client remove the token
        res.json({ message: 'Logged out successfully' });
    }
    catch (error) {
        console.error('Error during logout:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
//# sourceMappingURL=auth.js.map