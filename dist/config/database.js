"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.testConnection = testConnection;
const pg_1 = require("pg");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const poolConfig = {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    max: 20,
    idleTimeoutMillis: 60000, // 60 seconds - keep connections alive longer
    connectionTimeoutMillis: 30000, // 30 seconds - increased for remote database (AWS App Runner)
    // SSL configuration for AWS RDS (required for RDS)
    ssl: process.env.DB_SSL === 'true' ? {
        rejectUnauthorized: false, // Set to true in production with proper certificates
    } : false,
};
exports.pool = new pg_1.Pool(poolConfig);
exports.pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    // Don't exit process in production, just log the error
    if (process.env.NODE_ENV !== 'production') {
        process.exit(-1);
    }
});
// Test connection with better error handling
exports.pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('Database connection error:', err.message);
        console.error('Error code:', err.code);
        console.error('Error details:', err);
    }
    else {
        console.log('Database connected successfully');
    }
});
// Helper function to test database connection
async function testConnection() {
    try {
        const result = await exports.pool.query('SELECT NOW()');
        console.log('Database connection test successful:', result.rows[0]);
        return true;
    }
    catch (error) {
        console.error('Database connection test failed:', error.message);
        console.error('Error details:', error);
        return false;
    }
}
exports.default = exports.pool;
//# sourceMappingURL=database.js.map