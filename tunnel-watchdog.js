#!/usr/bin/env node
/**
 * Tunnel watchdog - keeps the localtunnel alive
 * Restarts automatically if the tunnel dies
 */
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const path = require('path');

const PORT = 3456;
const SUBDOMAIN = 'olympian-rng';
const CHECK_INTERVAL = 15000; // check every 15s
const TUNNEL_URL = `https://${SUBDOMAIN}.loca.lt`;

let tunnelProcess = null;
let restartCount = 0;

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function startTunnel() {
  return new Promise((resolve, reject) => {
    const ltPath = path.join(__dirname, 'node_modules', '.bin', 'lt');
    const proc = spawn(ltPath, ['--port', String(PORT), '--subdomain', SUBDOMAIN], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolved = false;

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      log(`tunnel: ${text.trim()}`);
      if (!resolved && text.includes('loca.lt')) {
        resolved = true;
        resolve(proc);
      }
    });

    proc.stderr.on('data', (data) => {
      log(`tunnel stderr: ${data.toString().trim()}`);
    });

    proc.on('exit', (code) => {
      log(`tunnel exited with code ${code}`);
      if (!resolved) reject(new Error(`exited ${code}`));
    });

    proc.on('error', (err) => {
      log(`tunnel error: ${err.message}`);
      if (!resolved) reject(err);
    });

    // timeout after 30s
    setTimeout(() => {
      if (!resolved) {
        log('tunnel startup timeout - checking if running anyway');
        resolved = true;
        resolve(proc);
      }
    }, 30000);
  });
}

async function checkTunnel() {
  return new Promise((resolve) => {
    const req = https.get(TUNNEL_URL + '/', { timeout: 10000 }, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 500);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function main() {
  log('🚀 Tunnel watchdog starting...');

  // Start tunnel
  try {
    tunnelProcess = await startTunnel();
    log(`✅ Tunnel started (PID: ${tunnelProcess.pid})`);
  } catch (err) {
    log(`❌ Failed to start tunnel: ${err.message}`);
  }

  // Monitoring loop
  setInterval(async () => {
    const alive = await checkTunnel();
    if (alive) {
      log('✅ Tunnel OK');
      return;
    }

    log('⚠️  Tunnel down! Restarting...');
    restartCount++;

    // Kill old process if still hanging around
    if (tunnelProcess && !tunnelProcess.killed) {
      tunnelProcess.kill('SIGTERM');
      setTimeout(() => {
        if (tunnelProcess && !tunnelProcess.killed) tunnelProcess.kill('SIGKILL');
      }, 3000);
    }

    // Restart
    try {
      tunnelProcess = await startTunnel();
      log(`✅ Tunnel restarted (PID: ${tunnelProcess.pid}, restart #${restartCount})`);
    } catch (err) {
      log(`❌ Restart failed: ${err.message}`);
    }
  }, CHECK_INTERVAL);

  // Handle exit
  process.on('SIGINT', () => {
    log('Shutting down...');
    if (tunnelProcess && !tunnelProcess.killed) tunnelProcess.kill();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
