"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const database_1 = require("../config/database");
const auth_1 = require("../middleware/auth");
const s3Service_1 = require("../services/s3Service");
const router = express_1.default.Router();
// Configure multer for memory storage (to upload directly to S3)
const storage = multer_1.default.memoryStorage();
const upload = (0, multer_1.default)({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
    },
    fileFilter: (req, file, cb) => {
        // Allow all file types
        cb(null, true);
    },
});
// Get all knowledge base files (filtered by user's role)
router.get('/', auth_1.authenticateToken, async (req, res) => {
    try {
        const userRole = req.user?.role;
        const userId = req.user?.userId;
        if (!userRole) {
            return res.status(401).json({ error: 'User role not found' });
        }
        // Get files that are accessible to the user's role
        // Files with no roles assigned are visible to everyone
        const query = `
      SELECT 
        f.id,
        f.file_name,
        f.original_name,
        f.file_path,
        f.file_size,
        f.file_type,
        f.mime_type,
        f.description,
        f.uploaded_by_id,
        f.created_at,
        f.updated_at,
        u.full_name as uploaded_by_name,
        u.email as uploaded_by_email,
        CASE WHEN f.uploaded_by_id = $2 THEN true ELSE false END as is_owner,
        COALESCE(
          json_agg(
            json_build_object('role', fr.role)
          ) FILTER (WHERE fr.role IS NOT NULL),
          '[]'::json
        ) as assigned_roles
      FROM knowledge_base_files f
      LEFT JOIN users u ON f.uploaded_by_id = u.id
      LEFT JOIN knowledge_base_file_roles fr ON f.id = fr.file_id
      WHERE (
        -- File has no role restrictions (visible to all)
        NOT EXISTS (
          SELECT 1 FROM knowledge_base_file_roles fr2 
          WHERE fr2.file_id = f.id
        )
        OR
        -- File is assigned to user's role
        EXISTS (
          SELECT 1 FROM knowledge_base_file_roles fr3 
          WHERE fr3.file_id = f.id 
          AND fr3.role = $1
        )
      )
      GROUP BY f.id, f.file_name, f.original_name, f.file_path, f.file_size, f.file_type, 
               f.mime_type, f.description, f.uploaded_by_id, f.created_at, f.updated_at,
               u.full_name, u.email
      ORDER BY f.created_at DESC
    `;
        const result = await database_1.pool.query(query, [userRole, userId]);
        res.json(result.rows);
    }
    catch (error) {
        console.error('Error fetching knowledge base files:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get all files (for admin - shows all files with their role assignments)
router.get('/all', auth_1.authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.userId;
        const query = `
      SELECT 
        f.id,
        f.file_name,
        f.original_name,
        f.file_path,
        f.file_size,
        f.file_type,
        f.mime_type,
        f.description,
        f.uploaded_by_id,
        f.created_at,
        f.updated_at,
        u.full_name as uploaded_by_name,
        u.email as uploaded_by_email,
        CASE WHEN f.uploaded_by_id = $1 THEN true ELSE false END as is_owner,
        COALESCE(
          json_agg(
            json_build_object('role', fr.role)
          ) FILTER (WHERE fr.role IS NOT NULL),
          '[]'::json
        ) as assigned_roles
      FROM knowledge_base_files f
      LEFT JOIN users u ON f.uploaded_by_id = u.id
      LEFT JOIN knowledge_base_file_roles fr ON f.id = fr.file_id
      GROUP BY f.id, f.file_name, f.original_name, f.file_path, f.file_size, f.file_type, 
               f.mime_type, f.description, f.uploaded_by_id, f.created_at, f.updated_at,
               u.full_name, u.email
      ORDER BY f.created_at DESC
    `;
        const result = await database_1.pool.query(query, [userId]);
        res.json(result.rows);
    }
    catch (error) {
        console.error('Error fetching all knowledge base files:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Upload file
router.post('/upload', auth_1.authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        const { description, roles } = req.body;
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ error: 'User not authenticated' });
        }
        // Parse roles from JSON string or array
        let assignedRoles = [];
        if (roles) {
            if (Array.isArray(roles)) {
                assignedRoles = roles;
            }
            else if (typeof roles === 'string') {
                try {
                    assignedRoles = JSON.parse(roles);
                }
                catch (e) {
                    assignedRoles = [];
                }
            }
        }
        // Generate unique file name for S3
        const s3FileName = (0, s3Service_1.generateFileName)(req.file.originalname);
        // Upload file to S3
        const s3Url = await (0, s3Service_1.uploadFileToS3)(req.file, s3FileName);
        // Insert file record with S3 URL
        const fileResult = await database_1.pool.query(`INSERT INTO knowledge_base_files (
        file_name, original_name, file_path, file_size, file_type, mime_type,
        description, uploaded_by_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`, [
            s3FileName.split('/').pop(), // Just the file name
            req.file.originalname,
            s3Url, // Store S3 URL in file_path
            req.file.size,
            path_1.default.extname(req.file.originalname).substring(1),
            req.file.mimetype,
            description || null,
            userId,
        ]);
        const fileId = fileResult.rows[0].id;
        // Assign roles if provided
        if (assignedRoles && assignedRoles.length > 0) {
            for (const role of assignedRoles) {
                await database_1.pool.query('INSERT INTO knowledge_base_file_roles (file_id, role) VALUES ($1, $2) ON CONFLICT DO NOTHING', [fileId, role]);
            }
        }
        // Get file with roles
        const fileWithRoles = await database_1.pool.query(`SELECT 
        f.id,
        f.file_name,
        f.original_name,
        f.file_path,
        f.file_size,
        f.file_type,
        f.mime_type,
        f.description,
        f.uploaded_by_id,
        f.created_at,
        f.updated_at,
        u.full_name as uploaded_by_name,
        COALESCE(
          json_agg(
            json_build_object('role', fr.role)
          ) FILTER (WHERE fr.role IS NOT NULL),
          '[]'::json
        ) as assigned_roles
      FROM knowledge_base_files f
      LEFT JOIN users u ON f.uploaded_by_id = u.id
      LEFT JOIN knowledge_base_file_roles fr ON f.id = fr.file_id
      WHERE f.id = $1
      GROUP BY f.id, f.file_name, f.original_name, f.file_path, f.file_size, f.file_type, 
               f.mime_type, f.description, f.uploaded_by_id, f.created_at, f.updated_at,
               u.full_name`, [fileId]);
        res.status(201).json(fileWithRoles.rows[0]);
    }
    catch (error) {
        console.error('Error uploading file:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});
// Update file roles
router.put('/:id/roles', auth_1.authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { roles } = req.body;
        const userId = req.user?.userId;
        // Check if file exists and get ownership info
        const fileCheck = await database_1.pool.query('SELECT id, uploaded_by_id FROM knowledge_base_files WHERE id = $1', [id]);
        if (fileCheck.rows.length === 0) {
            return res.status(404).json({ error: 'File not found' });
        }
        const file = fileCheck.rows[0];
        // Check if user is admin or file owner
        // Admin roles: Corporate Admin, Territory Admin (canEditAllLeads permission)
        const userRole = req.user?.role;
        const isAdmin = userRole === 'Corporate Admin' || userRole === 'Territory Admin';
        const isOwner = file.uploaded_by_id === userId;
        if (!isAdmin && !isOwner) {
            return res.status(403).json({ error: 'You do not have permission to edit this file' });
        }
        // Parse roles (handle both array and JSON string)
        let assignedRoles = [];
        if (roles) {
            if (Array.isArray(roles)) {
                assignedRoles = roles;
            }
            else if (typeof roles === 'string') {
                try {
                    assignedRoles = JSON.parse(roles);
                }
                catch (e) {
                    assignedRoles = [];
                }
            }
        }
        // Delete existing role assignments
        await database_1.pool.query('DELETE FROM knowledge_base_file_roles WHERE file_id = $1', [id]);
        // Add new role assignments
        if (assignedRoles.length > 0) {
            for (const role of assignedRoles) {
                await database_1.pool.query('INSERT INTO knowledge_base_file_roles (file_id, role) VALUES ($1, $2)', [id, role]);
            }
        }
        // Update updated_at timestamp
        await database_1.pool.query('UPDATE knowledge_base_files SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
        // Get updated file with roles
        const fileWithRoles = await database_1.pool.query(`SELECT 
        f.id,
        f.file_name,
        f.original_name,
        f.file_path,
        f.file_size,
        f.file_type,
        f.mime_type,
        f.description,
        f.uploaded_by_id,
        f.created_at,
        f.updated_at,
        u.full_name as uploaded_by_name,
        COALESCE(
          json_agg(
            json_build_object('role', fr.role)
          ) FILTER (WHERE fr.role IS NOT NULL),
          '[]'::json
        ) as assigned_roles
      FROM knowledge_base_files f
      LEFT JOIN users u ON f.uploaded_by_id = u.id
      LEFT JOIN knowledge_base_file_roles fr ON f.id = fr.file_id
      WHERE f.id = $1
      GROUP BY f.id, f.file_name, f.original_name, f.file_path, f.file_size, f.file_type, 
               f.mime_type, f.description, f.uploaded_by_id, f.created_at, f.updated_at,
               u.full_name`, [id]);
        res.json(fileWithRoles.rows[0]);
    }
    catch (error) {
        console.error('Error updating file roles:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});
// Delete file
router.delete('/:id', auth_1.authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.userId;
        // Get file info including ownership
        const fileResult = await database_1.pool.query('SELECT file_path, uploaded_by_id FROM knowledge_base_files WHERE id = $1', [id]);
        if (fileResult.rows.length === 0) {
            return res.status(404).json({ error: 'File not found' });
        }
        const file = fileResult.rows[0];
        // Check if user is admin or file owner
        // Admin roles: Corporate Admin, Territory Admin (canEditAllLeads permission)
        const userRole = req.user?.role;
        const isAdmin = userRole === 'Corporate Admin' || userRole === 'Territory Admin';
        const isOwner = file.uploaded_by_id === userId;
        if (!isAdmin && !isOwner) {
            return res.status(403).json({ error: 'You do not have permission to delete this file' });
        }
        const s3Url = file.file_path;
        // Delete file from database (cascade will delete role assignments)
        await database_1.pool.query('DELETE FROM knowledge_base_files WHERE id = $1', [id]);
        // Delete file from S3
        try {
            await (0, s3Service_1.deleteFileFromS3)(s3Url);
        }
        catch (error) {
            console.error('Error deleting file from S3:', error);
            // Continue even if S3 deletion fails (file is already removed from database)
        }
        res.json({ message: 'File deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});
// Download file
router.get('/:id/download', auth_1.authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userRole = req.user?.role;
        // Check if file exists and user has access
        const fileQuery = `
      SELECT f.*
      FROM knowledge_base_files f
      WHERE f.id = $1
      AND (
        -- File has no role restrictions
        NOT EXISTS (
          SELECT 1 FROM knowledge_base_file_roles fr 
          WHERE fr.file_id = f.id
        )
        OR
        -- File is assigned to user's role
        EXISTS (
          SELECT 1 FROM knowledge_base_file_roles fr 
          WHERE fr.file_id = f.id 
          AND fr.role = $2
        )
      )
    `;
        const fileResult = await database_1.pool.query(fileQuery, [id, userRole]);
        if (fileResult.rows.length === 0) {
            return res.status(404).json({ error: 'File not found or access denied' });
        }
        const file = fileResult.rows[0];
        const s3Url = file.file_path;
        // Redirect to S3 URL (since bucket is public)
        res.redirect(s3Url);
    }
    catch (error) {
        console.error('Error downloading file:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});
exports.default = router;
//# sourceMappingURL=knowledgeBase.js.map