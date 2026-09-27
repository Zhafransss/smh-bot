/**
 * PM2 process config — keeps the SMH chatbot alive 24/7 (auto-restart on crash / server reboot).
 *
 *   npm run pm2:start     start (NODE_ENV=production)
 *   npm run pm2:logs      follow logs (also where the WhatsApp QR code appears)
 *   npm run pm2:restart   restart after deploying new code
 *   npm run pm2:stop      stop
 *
 * See README "Menjalankan 24/7 dengan PM2" for boot-time startup on Windows / Linux.
 */
const path = require('path');

const apps = [
  {
    name: 'smh-bot',
    script: 'src/server.js',
    cwd: __dirname,

    // MUST stay a single fork process: one Baileys session = one WhatsApp socket.
    // Two instances would kick each other off (DisconnectReason.connectionReplaced).
    exec_mode: 'fork',
    instances: 1,

    env: {
      NODE_ENV: 'production',
    },

    // Crash handling: restart forever with exponential backoff (100ms → max 15s),
    // e.g. while MySQL/Redis is still booting after a server restart.
    autorestart: true,
    exp_backoff_restart_delay: 100,
    min_uptime: '30s',
    max_restarts: 100000,
    max_memory_restart: '500M',

    // Graceful shutdown: server.js waits for in-flight replies (typing delay up to ~10s)
    // and force-exits after 15s, so give it a bit longer than that.
    kill_timeout: 20000,
    shutdown_with_message: true, // Windows has no SIGINT for child processes; server.js listens for 'shutdown'

    // Watching is for development (nodemon); never auto-restart on file changes in production
    watch: false,

    out_file: path.join(__dirname, 'logs', 'smh-bot.out.log'),
    error_file: path.join(__dirname, 'logs', 'smh-bot.error.log'),
    merge_logs: true,
    time: true,
  },
];

// Optional: let PM2 also supervise Redis on a Windows machine without a Redis service.
// Set REDIS_SERVER_PATH to the redis-server executable before `pm2 start`.
// On Linux/VPS prefer the OS service instead (e.g. `systemctl enable --now redis-server`).
if (process.env.REDIS_SERVER_PATH) {
  apps.unshift({
    name: 'smh-redis',
    script: process.env.REDIS_SERVER_PATH,
    args: '--port 6379',
    cwd: __dirname, // keeps dump.rdb in the project folder, same as start-redis.bat
    interpreter: 'none',
    autorestart: true,
    exp_backoff_restart_delay: 100,
    max_restarts: 100000,
    out_file: path.join(__dirname, 'logs', 'smh-redis.out.log'),
    error_file: path.join(__dirname, 'logs', 'smh-redis.error.log'),
    time: true,
  });
}

module.exports = { apps };
