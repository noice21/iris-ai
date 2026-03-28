import { readdir, readFile, writeFile, stat, rename, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';

// Local mode only — export empty tools in cloud mode
function isLocalMode() {
  return process.env.CLOUD_MODE !== 'true';
}

function getBaseDir() {
  return process.env.FILESYSTEM_BASE_DIR || os.homedir();
}

/**
 * Resolve and validate a path is within the allowed base directory
 */
function resolveSafePath(userPath) {
  const baseDir = path.normalize(getBaseDir());
  const resolved = path.normalize(path.resolve(baseDir, userPath));

  if (!resolved.startsWith(baseDir)) {
    throw new Error(`Access denied: path "${userPath}" is outside the allowed directory.`);
  }

  return resolved;
}

/**
 * List files and folders in a directory
 */
async function listDirectory(dirPath) {
  const safePath = resolveSafePath(dirPath);

  const entries = await readdir(safePath, { withFileTypes: true });

  const items = entries.map(entry => ({
    name: entry.name,
    type: entry.isDirectory() ? 'directory' : 'file',
    path: path.join(dirPath, entry.name)
  }));

  // Sort: directories first, then files
  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return {
    success: true,
    path: dirPath,
    itemCount: items.length,
    items: items.slice(0, 200) // Limit to 200 entries
  };
}

/**
 * Read a text file
 */
async function readTextFile(filePath, maxLines = 200) {
  const safePath = resolveSafePath(filePath);

  // Check file size (max 1MB)
  const stats = await stat(safePath);
  if (stats.size > 1024 * 1024) {
    return {
      success: false,
      error: `File is too large (${(stats.size / 1024 / 1024).toFixed(2)} MB). Maximum is 1 MB.`
    };
  }

  const content = await readFile(safePath, 'utf-8');
  const lines = content.split('\n');
  const truncated = lines.length > maxLines;
  const resultLines = truncated ? lines.slice(0, maxLines) : lines;

  return {
    success: true,
    path: filePath,
    content: resultLines.join('\n'),
    totalLines: lines.length,
    linesReturned: resultLines.length,
    truncated,
    fileSize: stats.size
  };
}

/**
 * Write or append to a file
 */
async function writeTextFile(filePath, content, append = false) {
  const safePath = resolveSafePath(filePath);

  // Max content size: 5MB
  if (content.length > 5 * 1024 * 1024) {
    return {
      success: false,
      error: 'Content too large. Maximum is 5 MB.'
    };
  }

  // Ensure parent directory exists
  const dir = path.dirname(safePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  if (append) {
    const { appendFile } = await import('fs/promises');
    await appendFile(safePath, content, 'utf-8');
  } else {
    await writeFile(safePath, content, 'utf-8');
  }

  return {
    success: true,
    path: filePath,
    action: append ? 'appended' : 'written',
    bytesWritten: Buffer.byteLength(content, 'utf-8')
  };
}

/**
 * Search for files by name pattern (recursive)
 */
async function searchFiles(pattern, directory = '.') {
  const safePath = resolveSafePath(directory);
  const results = [];
  const maxDepth = 5;
  const maxResults = 100;
  const lowerPattern = pattern.toLowerCase();

  async function walk(dir, depth) {
    if (depth > maxDepth || results.length >= maxResults) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // Skip directories we can't read
    }

    for (const entry of entries) {
      if (results.length >= maxResults) break;

      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(safePath, fullPath);

      if (entry.name.toLowerCase().includes(lowerPattern)) {
        results.push({
          name: entry.name,
          path: path.join(directory, relativePath),
          type: entry.isDirectory() ? 'directory' : 'file'
        });
      }

      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        await walk(fullPath, depth + 1);
      }
    }
  }

  await walk(safePath, 0);

  return {
    success: true,
    pattern,
    directory,
    resultCount: results.length,
    results,
    maxResultsReached: results.length >= maxResults
  };
}

/**
 * Get file metadata
 */
async function getFileInfo(filePath) {
  const safePath = resolveSafePath(filePath);

  const stats = await stat(safePath);

  return {
    success: true,
    path: filePath,
    name: path.basename(safePath),
    type: stats.isDirectory() ? 'directory' : 'file',
    size: stats.size,
    sizeFormatted: formatSize(stats.size),
    modified: stats.mtime.toISOString(),
    created: stats.birthtime.toISOString(),
    extension: stats.isFile() ? path.extname(safePath) : null
  };
}

/**
 * Move or rename a file
 */
async function moveFile(source, destination) {
  const safeSource = resolveSafePath(source);
  const safeDest = resolveSafePath(destination);

  // Ensure parent directory of destination exists
  const destDir = path.dirname(safeDest);
  if (!existsSync(destDir)) {
    await mkdir(destDir, { recursive: true });
  }

  await rename(safeSource, safeDest);

  return {
    success: true,
    source,
    destination,
    message: `Moved "${path.basename(safeSource)}" to "${destination}"`
  };
}

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Tool definitions — empty in cloud mode
export const FILESYSTEM_TOOLS = isLocalMode() ? [
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files and folders in a directory on the local computer.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path to list (relative to base directory or absolute)'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a text file on the local computer.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file to read'
          },
          max_lines: {
            type: 'number',
            description: 'Maximum number of lines to return (default: 200)'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file on the local computer. Creates the file if it doesn\'t exist.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file to write'
          },
          content: {
            type: 'string',
            description: 'Content to write to the file'
          },
          append: {
            type: 'boolean',
            description: 'If true, append to the file instead of overwriting (default: false)'
          }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search for files by name pattern in a directory (recursive). Searches up to 5 levels deep.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'File name pattern to search for (e.g., "report", ".pdf", "config")'
          },
          directory: {
            type: 'string',
            description: 'Directory to search in (default: base directory)'
          }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_file_info',
      description: 'Get metadata about a file or directory (size, dates, type).',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file or directory'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'move_file',
      description: 'Move or rename a file or directory.',
      parameters: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Current path of the file or directory'
          },
          destination: {
            type: 'string',
            description: 'New path for the file or directory'
          }
        },
        required: ['source', 'destination']
      }
    }
  }
] : [];

/**
 * Execute a filesystem tool
 */
export async function executeFilesystemTool(toolName, args = {}) {
  console.log(`[Filesystem] Executing tool: ${toolName}`, args);

  try {
    switch (toolName) {
      case 'list_directory':
        return await listDirectory(args.path);

      case 'read_file':
        return await readTextFile(args.path, args.max_lines || 200);

      case 'write_file':
        return await writeTextFile(args.path, args.content, args.append || false);

      case 'search_files':
        return await searchFiles(args.pattern, args.directory || '.');

      case 'get_file_info':
        return await getFileInfo(args.path);

      case 'move_file':
        return await moveFile(args.source, args.destination);

      default:
        throw new Error(`Unknown filesystem tool: ${toolName}`);
    }
  } catch (error) {
    console.error(`[Filesystem] Tool execution failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}
