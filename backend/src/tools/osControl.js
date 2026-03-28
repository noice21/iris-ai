import { exec, spawn } from 'child_process';
import { promisify } from 'util';

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
