#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { parseArgs } = require('util');

const HELP_TEXT = `
OpenCode Analytics
===================

Usage: opencode-analytics [options]

Options:
  --port, -p <port>    Port to run server on (default: 3456)
  --db <path>          Path to OpenCode database (auto-detected by OS)
  --no-open            Don't open browser automatically
  --help, -h          Show this help message

Examples:
  opencode-analytics
  opencode-analytics --port 4000
  opencode-analytics --db /custom/path/opencode.db
  opencode-analytics --port 3000 --no-open

Database locations by OS:
  Linux/macOS:  ~/.local/share/opencode/opencode.db
  Windows:       %USERPROFILE%\\.local\\share\\opencode\\opencode.db

Override with: OPENCODE_DB_PATH environment variable
`;

function detectDbPath() {
  const home = process.env.HOME || process.env.USERPROFILE;
  
  if (!home) {
    console.error('Could not detect home directory');
    process.exit(1);
  }
  
  const dataDir = path.join(home, '.local', 'share', 'opencode');
  const dbPath = path.join(dataDir, 'opencode.db');
  
  return dbPath;
}

function findDbPath() {
  if (process.env.OPENCODE_DB_PATH) {
    return process.env.OPENCODE_DB_PATH;
  }
  return detectDbPath();
}

function openBrowser(url) {
  const { spawn: spawnOpen } = require('open');
  spawnOpen(url);
}

async function main() {
  const options = {
    port: {
      type: 'string',
      short: 'p',
      default: '3456'
    },
    db: {
      type: 'string'
    },
    'no-open': {
      type: 'boolean',
      default: false
    },
    help: {
      type: 'boolean',
      short: 'h',
      default: false
    }
  };
  
  let args;
  try {
    args = parseArgs({ options, allowPositionals: false });
  } catch (e) {
    console.error('Invalid arguments:', e.message);
    console.log(HELP_TEXT);
    process.exit(1);
  }
  
  if (args.values.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }
  
  const port = parseInt(args.values.port) || 3456;
  const dbPath = args.values.db || findDbPath();
  const shouldOpen = !args.values['no-open'];
  
  console.log(`OpenCode Analytics v1.0.0`);
  console.log(`Database: ${dbPath}`);
  
  if (!fs.existsSync(dbPath)) {
    console.error(`\nError: Database not found at: ${dbPath}`);
    console.error(`\nPlease ensure OpenCode has been used at least once on this machine.`);
    console.error(`Or specify a custom DB path with: --db /path/to/opencode.db`);
    process.exit(1);
  }
  
  const serverPath = path.join(__dirname, '..', 'server', 'index.js');
  
  if (!fs.existsSync(serverPath)) {
    console.error(`Error: Server not found at: ${serverPath}`);
    process.exit(1);
  }
  
  process.env.OPENCODE_DB_PATH = dbPath;
  process.env.PORT = port;
  
  const serverProcess = spawn(process.execPath, [serverPath], {
    env: { ...process.env, OPENCODE_DB_PATH: dbPath, PORT: port.toString() },
    stdio: 'inherit'
  });
  
  serverProcess.on('error', (err) => {
    console.error('Server error:', err);
    process.exit(1);
  });
  
  serverProcess.on('close', (code) => {
    process.exit(code);
  });
  
  setTimeout(() => {
    const url = `http://localhost:${port}`;
    console.log(`\nServer running at: ${url}`);
    
    if (shouldOpen) {
      console.log('Opening browser...');
      openBrowser(url);
    }
  }, 1000);
}

main();
