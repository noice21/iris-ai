import mysql from 'mysql2/promise';

let pool = null;

/**
 * Get database connection pool
 * @returns {Promise<mysql.Pool>} - MySQL connection pool
 */
export async function getPool() {
  if (pool) return pool;

  const commonOpts = {
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  };

  if (process.env.MYSQL_URL) {
    // Railway / cloud: parse connection URL
    const url = new URL(process.env.MYSQL_URL);
    pool = mysql.createPool({
      host: url.hostname,
      port: parseInt(url.port || '3306'),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.slice(1),
      ...commonOpts
    });
  } else {
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST || 'localhost',
      port: parseInt(process.env.MYSQL_PORT || '3306'),
      user: process.env.MYSQL_USER || 'iris_user',
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE || 'iris_ai',
      ...commonOpts
    });
  }

  // Test connection
  try {
    const connection = await pool.getConnection();
    console.log('Database connected successfully');
    connection.release();
  } catch (error) {
    console.error('Database connection failed:', error.message);
    throw error;
  }

  return pool;
}

/**
 * Execute a query
 * @param {string} sql - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<any>} - Query result
 */
export async function query(sql, params = []) {
  const pool = await getPool();
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/**
 * Close database connection pool
 */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('Database connection closed');
  }
}

export { pool };
