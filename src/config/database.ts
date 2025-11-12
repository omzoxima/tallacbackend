import { Pool, PoolConfig } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const poolConfig: PoolConfig = {
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

export const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  // Don't exit process in production, just log the error
  if (process.env.NODE_ENV !== 'production') {
    process.exit(-1);
  }
});

// Test connection with better error handling
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Database connection error:', err.message);
    console.error('Error code:', (err as any).code);
    console.error('Error details:', err);
  } else {
    console.log('Database connected successfully');
  }
});

// Helper function to test database connection
export async function testConnection(): Promise<boolean> {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('Database connection test successful:', result.rows[0]);
    return true;
  } catch (error: any) {
    console.error('Database connection test failed:', error.message);
    console.error('Error details:', error);
    return false;
  }
}

export default pool;

