import jwt from 'jsonwebtoken';
import pool from '../config/database.js';

export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ success: false, message: 'Access token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user from database - handle both camelCase and snake_case columns
    // Actual database has: active, is_active (NOT enabled)
    const result = await pool.query(
      `SELECT u.*, 
              tu.tallac_role, 
              tu.status as tallac_status, 
              tu.reports_to,
              COALESCE(u."is_active", u.active, true) as is_enabled
       FROM users u
       LEFT JOIN tallac_users tu ON u.id = tu.user_id
       WHERE u.id = $1`,
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    const user = result.rows[0];
    
    // Check if account is enabled - use actual column names from database
    const isEnabled = (user.is_enabled !== false && user.is_enabled !== 0 && user.is_enabled !== null) ||
                      (user.active !== false && user.active !== 0 && user.active !== null) ||
                      (user.is_active !== false && user.is_active !== 0 && user.is_active !== null);
    
    if (!isEnabled) {
      return res.status(401).json({ success: false, message: 'Account is disabled' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired' });
    }
    console.error('Auth error:', error);
    return res.status(500).json({ success: false, message: 'Authentication error' });
  }
};

export const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const userRole = req.user.tallac_role || req.user.role;
    if (!roles.includes(userRole)) {
      return res.status(403).json({ 
        success: false, 
        message: `Access denied. Required roles: ${roles.join(', ')}` 
      });
    }

    next();
  };
};

