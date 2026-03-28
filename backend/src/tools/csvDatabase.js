import mysql from 'mysql2/promise';

// Pool-per-database cache
const pools = new Map();

// Parse MySQL credentials from MYSQL_URL or individual env vars
function getMysqlCredentials() {
  if (process.env.MYSQL_URL) {
    const url = new URL(process.env.MYSQL_URL);
    return {
      host: url.hostname,
      port: parseInt(url.port || '3306'),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password)
    };
  }
  return {
    host: process.env.CSV_DB_HOST || process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.CSV_DB_PORT || process.env.MYSQL_PORT || '3306'),
    user: process.env.CSV_DB_USER || process.env.MYSQL_USER || 'root',
    password: process.env.CSV_DB_PASSWORD || process.env.MYSQL_PASSWORD || ''
  };
}

function getPool(databaseName) {
  if (pools.has(databaseName)) return pools.get(databaseName);

  const creds = getMysqlCredentials();
  const pool = mysql.createPool({
    ...creds, database: databaseName,
    waitForConnections: true,
    connectionLimit: 3,
    queueLimit: 0
  });
  console.log(`[CSVDatabase] Pool created for ${databaseName}@${creds.host}:${creds.port}`);
  pools.set(databaseName, pool);
  return pool;
}

// Get a connection without a specific database (for listing databases)
function getBasePool() {
  if (pools.has('__base__')) return pools.get('__base__');

  const creds = getMysqlCredentials();
  const pool = mysql.createPool({
    ...creds,
    waitForConnections: true,
    connectionLimit: 2,
    queueLimit: 0
  });
  pools.set('__base__', pool);
  return pool;
}

// System databases and tables to exclude
const SYSTEM_DATABASES = ['information_schema', 'mysql', 'performance_schema', 'sys', 'iris_ai'];
const SYSTEM_TABLES = ['users', 'conversations', 'messages', 'user_facts'];

/**
 * List all available databases (excludes system DBs)
 */
export async function listDatabases() {
  console.log('[CSVDatabase] Listing databases...');
  const db = getBasePool();
  const [rows] = await db.query('SHOW DATABASES');
  const databases = rows
    .map(row => row.Database || Object.values(row)[0])
    .filter(name => !SYSTEM_DATABASES.includes(name));

  return {
    success: true,
    databases,
    totalDatabases: databases.length
  };
}

/**
 * List all CSV data tables in a database (excludes system tables)
 */
export async function listCsvTables(databaseName) {
  if (!databaseName) {
    return { success: false, error: 'database_name is required. Use list_csv_databases first to discover available databases.' };
  }
  console.log(`[CSVDatabase] Listing tables in ${databaseName}...`);
  const db = getPool(databaseName);
  const [tables] = await db.query('SHOW TABLES');
  const key = `Tables_in_${databaseName}`;

  const csvTables = [];
  for (const row of tables) {
    const name = row[key] || Object.values(row)[0];
    if (SYSTEM_TABLES.includes(name)) continue;

    const [countResult] = await db.query(`SELECT COUNT(*) as count FROM \`${name}\``);
    const [cols] = await db.query(`DESCRIBE \`${name}\``);
    csvTables.push({
      table: name,
      columns: cols.map(c => c.Field),
      rowCount: countResult[0].count
    });
  }

  return {
    success: true,
    database: databaseName,
    tables: csvTables,
    totalTables: csvTables.length
  };
}

/**
 * Describe a table's columns and structure
 */
export async function describeCsvTable(databaseName, tableName) {
  if (!databaseName) {
    return { success: false, error: 'database_name is required. Use list_csv_databases first to discover available databases.' };
  }
  console.log(`[CSVDatabase] Describing ${databaseName}.${tableName}`);
  const db = getPool(databaseName);

  const [cols] = await db.query(`DESCRIBE \`${tableName}\``);
  const [countResult] = await db.query(`SELECT COUNT(*) as count FROM \`${tableName}\``);
  const [sampleRows] = await db.query(`SELECT * FROM \`${tableName}\` LIMIT 3`);

  return {
    success: true,
    database: databaseName,
    table: tableName,
    columns: cols.map(c => ({
      name: c.Field,
      type: c.Type,
      nullable: c.Null === 'YES',
      key: c.Key || null
    })),
    rowCount: countResult[0].count,
    sampleRows
  };
}

/**
 * Query rows from a CSV table with optional filtering
 */
export async function queryCsvTable(databaseName, tableName, { columns, where, orderBy, limit = 50, offset = 0 } = {}) {
  if (!databaseName) {
    return { success: false, error: 'database_name is required. Use list_csv_databases first to discover available databases.' };
  }
  console.log(`[CSVDatabase] Querying ${databaseName}.${tableName}`);
  const db = getPool(databaseName);

  const selectCols = columns && columns.length > 0
    ? columns.map(c => `\`${c}\``).join(', ')
    : '*';

  let query = `SELECT ${selectCols} FROM \`${tableName}\``;
  const params = [];

  if (where && typeof where === 'object' && Object.keys(where).length > 0) {
    const conditions = [];
    for (const [key, value] of Object.entries(where)) {
      conditions.push(`\`${key}\` = ?`);
      params.push(value);
    }
    query += ` WHERE ${conditions.join(' AND ')}`;
  }

  if (orderBy) {
    query += ` ORDER BY \`${orderBy}\``;
  }

  const safeLimit = Math.min(limit, 100);
  query += ` LIMIT ? OFFSET ?`;
  params.push(safeLimit, offset);

  const [rows] = await db.query(query, params);
  const [countResult] = await db.query(`SELECT COUNT(*) as count FROM \`${tableName}\``);

  return {
    success: true,
    database: databaseName,
    table: tableName,
    rows,
    returned: rows.length,
    totalRows: countResult[0].count,
    offset,
    limit: safeLimit
  };
}

/**
 * Search across all columns of a CSV table for a text match
 */
export async function searchCsvTable(databaseName, tableName, searchText) {
  if (!databaseName) {
    return { success: false, error: 'database_name is required. Use list_csv_databases first to discover available databases.' };
  }
  console.log(`[CSVDatabase] Searching ${databaseName}.${tableName} for: "${searchText}"`);
  const db = getPool(databaseName);

  const [cols] = await db.query(`DESCRIBE \`${tableName}\``);
  const conditions = cols.map(c => `\`${c.Field}\` LIKE ?`);
  const params = cols.map(() => `%${searchText}%`);

  const query = `SELECT * FROM \`${tableName}\` WHERE ${conditions.join(' OR ')} LIMIT 50`;
  const [rows] = await db.query(query, params);

  return {
    success: true,
    database: databaseName,
    table: tableName,
    searchText,
    matches: rows,
    matchCount: rows.length
  };
}

// Tool definitions for LLM function calling
export const CSV_DATABASE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_csv_databases',
      description: 'List all available databases that contain CSV/spreadsheet data. Use this first to discover what databases are available before querying tables.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_csv_tables',
      description: 'List all data tables in a specific database. Shows table names, column names, and row counts.',
      parameters: {
        type: 'object',
        properties: {
          database_name: { type: 'string', description: 'The database to list tables from' }
        },
        required: ['database_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'describe_csv_table',
      description: 'Get detailed information about a table including column names, types, row count, and sample rows.',
      parameters: {
        type: 'object',
        properties: {
          database_name: { type: 'string', description: 'The database containing the table' },
          table_name: { type: 'string', description: 'The name of the table to describe' }
        },
        required: ['database_name', 'table_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_csv_table',
      description: 'Query rows from a data table. Supports selecting specific columns, filtering by column values, ordering, and pagination. Returns up to 100 rows.',
      parameters: {
        type: 'object',
        properties: {
          database_name: { type: 'string', description: 'The database containing the table' },
          table_name: { type: 'string', description: 'The table to query' },
          columns: { type: 'array', items: { type: 'string' }, description: 'Specific columns to return (omit for all columns)' },
          where: { type: 'object', description: 'Filter conditions as key-value pairs, e.g. {"Class": "Warrior", "Level": "5"}' },
          order_by: { type: 'string', description: 'Column name to sort results by' },
          limit: { type: 'number', description: 'Max rows to return (default 50, max 100)' },
          offset: { type: 'number', description: 'Number of rows to skip (for pagination)' }
        },
        required: ['database_name', 'table_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_csv_table',
      description: 'Search for text across all columns of a table. Returns rows where any column contains the search text.',
      parameters: {
        type: 'object',
        properties: {
          database_name: { type: 'string', description: 'The database containing the table' },
          table_name: { type: 'string', description: 'The table to search in' },
          search_text: { type: 'string', description: 'Text to search for (partial matches supported)' }
        },
        required: ['database_name', 'table_name', 'search_text']
      }
    }
  }
];

/**
 * Execute a CSV database tool by name
 */
export async function executeCsvDatabaseTool(toolName, args = {}) {
  try {
    switch (toolName) {
      case 'list_csv_databases':
        return await listDatabases();
      case 'list_csv_tables':
        return await listCsvTables(args.database_name);
      case 'describe_csv_table':
        return await describeCsvTable(args.database_name, args.table_name);
      case 'query_csv_table':
        return await queryCsvTable(args.database_name, args.table_name, {
          columns: args.columns,
          where: args.where,
          orderBy: args.order_by,
          limit: args.limit,
          offset: args.offset
        });
      case 'search_csv_table':
        return await searchCsvTable(args.database_name, args.table_name, args.search_text);
      default:
        return { success: false, error: `Unknown CSV database tool: ${toolName}` };
    }
  } catch (error) {
    console.error(`[CSVDatabase] Tool ${toolName} failed:`, error.message);
    return { success: false, error: error.message };
  }
}
