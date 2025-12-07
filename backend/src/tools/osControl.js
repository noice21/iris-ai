import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import puppeteer from 'puppeteer';

const execAsync = promisify(exec);

/**
 * Get list of running processes
 */
export async function listRunningProcesses() {
  try {
    const { stdout } = await execAsync('tasklist /FO CSV /NH');

    const lines = stdout.split('\n').filter(line => line.trim());
    const processes = lines.map(line => {
      const match = line.match(/"([^"]+)","(\d+)"/);
      if (match) {
        return {
          name: match[1],
          pid: parseInt(match[2])
        };
      }
      return null;
    }).filter(p => p !== null);

    return {
      success: true,
      processCount: processes.length,
      processes: processes.slice(0, 50) // Limit to first 50 for brevity
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Check if a specific process is running
 */
export async function checkProcessRunning(processName) {
  try {
    const { stdout } = await execAsync(`tasklist /FI "IMAGENAME eq ${processName}" /FO CSV /NH`);

    const isRunning = stdout.includes(processName);

    if (isRunning) {
      const match = stdout.match(/"([^"]+)","(\d+)"/);
      return {
        success: true,
        running: true,
        processName: match ? match[1] : processName,
        pid: match ? parseInt(match[2]) : null
      };
    }

    return {
      success: true,
      running: false,
      processName: processName
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Kill (stop) a process by name or PID
 */
export async function killProcess(identifier) {
  try {
    // Check if identifier is a number (PID) or string (process name)
    const isPID = !isNaN(identifier);

    let command;
    if (isPID) {
      command = `taskkill /F /PID ${identifier}`;
    } else {
      command = `taskkill /F /IM ${identifier}`;
    }

    const { stdout } = await execAsync(command);

    return {
      success: true,
      message: `Process ${identifier} terminated successfully`,
      output: stdout.trim()
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: `Failed to terminate process ${identifier}`
    };
  }
}

/**
 * Start a program
 */
export async function startProgram(programPath, args = []) {
  try {
    // Use spawn to start the process without waiting for it to complete
    const child = spawn(programPath, args, {
      detached: true,
      stdio: 'ignore'
    });

    child.unref(); // Allow the parent to exit independently

    return {
      success: true,
      message: `Program ${programPath} started successfully`,
      pid: child.pid
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: `Failed to start program ${programPath}`
    };
  }
}

/**
 * Restart a program (kill and start)
 */
export async function restartProgram(processName, programPath, args = []) {
  try {
    // First, kill the process if it's running
    const checkResult = await checkProcessRunning(processName);

    if (checkResult.running) {
      const killResult = await killProcess(processName);
      if (!killResult.success) {
        return {
          success: false,
          error: 'Failed to stop the existing process',
          details: killResult
        };
      }

      // Wait a moment for the process to fully terminate
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Start the program
    const startResult = await startProgram(programPath, args);

    return {
      success: startResult.success,
      message: `Program ${processName} restarted successfully`,
      wasRunning: checkResult.running,
      newPid: startResult.pid
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Search the web using headless browser and save information to memory
 */
export async function searchWeb(query, saveToMemory = true) {
  let browser;
  try {
    console.log(`[OSControl] Starting web search for: "${query}"`);

    // Launch headless browser with more robust settings
    // Try system Chrome first, then Edge, then fall back to bundled Chromium
    const chromePaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];

    let executablePath = undefined;
    const fs = await import('fs');
    for (const path of chromePaths) {
      if (fs.existsSync(path)) {
        executablePath = path;
        console.log(`[OSControl] Using browser at: ${path}`);
        break;
      }
    }

    browser = await puppeteer.launch({
      headless: 'new',
      executablePath, // Will use system browser if found, otherwise Puppeteer's bundled Chromium
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ],
      timeout: 30000
    });

    const page = await browser.newPage();

    // Set longer timeout for page operations
    page.setDefaultNavigationTimeout(30000);
    page.setDefaultTimeout(30000);

    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Search on DuckDuckGo (much more bot-friendly than Google)
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    console.log(`[OSControl] Navigating to DuckDuckGo: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait a bit for content to load
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Extract search results from DuckDuckGo
    const results = await page.evaluate(() => {
      const searchResults = [];

      // DuckDuckGo HTML version uses simple structure
      const resultElements = document.querySelectorAll('.result');

      for (let i = 0; i < Math.min(resultElements.length, 5); i++) {
        const element = resultElements[i];

        // Get title and link
        const linkElement = element.querySelector('.result__a');

        // Get snippet
        const snippetElement = element.querySelector('.result__snippet');

        if (linkElement) {
          searchResults.push({
            title: linkElement.textContent.trim(),
            url: linkElement.href,
            snippet: snippetElement ? snippetElement.textContent.trim() : ''
          });
        }
      }

      return searchResults;
    });

    // Get instant answer if available (DuckDuckGo's version of featured snippet)
    const instantAnswer = await page.evaluate(() => {
      const answerBox = document.querySelector('.result--answer');
      if (answerBox) {
        const text = answerBox.querySelector('.result__snippet');
        return text ? text.textContent.trim() : null;
      }
      return null;
    });

    await browser.close();

    console.log(`[OSControl] Found ${results.length} results for "${query}"`);

    return {
      success: true,
      query: query,
      featuredSnippet: instantAnswer,
      results: results,
      resultCount: results.length,
      savedToMemory: saveToMemory,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.error(`[OSControl] Failed to close browser: ${closeError.message}`);
      }
    }

    console.error(`[OSControl] Web search failed: ${error.message}`);
    console.error(`[OSControl] Stack trace: ${error.stack}`);

    return {
      success: false,
      error: error.message,
      query: query,
      details: `Search failed: ${error.message}. This could be due to network issues or timeout.`
    };
  }
}

// Tool definitions for OpenRouter function calling
export const OS_CONTROL_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_running_processes',
      description: 'List currently running processes/programs on the computer. Shows process names and PIDs.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'check_process_running',
      description: 'Check if a specific program/process is currently running on the computer.',
      parameters: {
        type: 'object',
        properties: {
          process_name: {
            type: 'string',
            description: 'The name of the process to check (e.g., "chrome.exe", "notepad.exe")'
          }
        },
        required: ['process_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'kill_process',
      description: 'Stop/kill a running process by name or PID. Use with caution.',
      parameters: {
        type: 'object',
        properties: {
          identifier: {
            type: 'string',
            description: 'Process name (e.g., "chrome.exe") or PID number to terminate'
          }
        },
        required: ['identifier']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'start_program',
      description: 'Start a program/application on the computer.',
      parameters: {
        type: 'object',
        properties: {
          program_path: {
            type: 'string',
            description: 'Full path to the executable or program name (e.g., "notepad.exe", "C:\\Program Files\\App\\app.exe")'
          },
          arguments: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional command-line arguments for the program'
          }
        },
        required: ['program_path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'restart_program',
      description: 'Restart a program by killing the existing process and starting it again.',
      parameters: {
        type: 'object',
        properties: {
          process_name: {
            type: 'string',
            description: 'Name of the process to restart (e.g., "chrome.exe")'
          },
          program_path: {
            type: 'string',
            description: 'Full path to restart the program'
          },
          arguments: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional command-line arguments'
          }
        },
        required: ['process_name', 'program_path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: 'Search the web using a headless browser to find information. The browser runs invisibly in the background. Use this when you need up-to-date information or facts you don\'t know.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query (e.g., "what is the weather today", "latest news about AI")'
          },
          save_to_memory: {
            type: 'boolean',
            description: 'Whether to save the search results to memory for future reference (default: true)'
          }
        },
        required: ['query']
      }
    }
  }
];

/**
 * Execute an OS control tool
 */
export async function executeOSTool(toolName, args = {}) {
  console.log(`[OSControl] Executing tool: ${toolName}`, args);

  try {
    let result;
    switch (toolName) {
      case 'list_running_processes':
        result = await listRunningProcesses();
        break;

      case 'check_process_running':
        result = await checkProcessRunning(args.process_name);
        break;

      case 'kill_process':
        result = await killProcess(args.identifier);
        break;

      case 'start_program':
        result = await startProgram(args.program_path, args.arguments || []);
        break;

      case 'restart_program':
        result = await restartProgram(
          args.process_name,
          args.program_path,
          args.arguments || []
        );
        break;

      case 'search_web':
        console.log(`[OSControl] Calling searchWeb with query: "${args.query}"`);
        result = await searchWeb(args.query, args.save_to_memory !== false);
        console.log(`[OSControl] searchWeb completed - success: ${result.success}`);
        break;

      default:
        throw new Error(`Unknown OS control tool: ${toolName}`);
    }

    return result;
  } catch (error) {
    console.error(`[OSControl] Tool execution failed: ${error.message}`);
    console.error(`[OSControl] Stack trace: ${error.stack}`);
    return { success: false, error: error.message };
  }
}
