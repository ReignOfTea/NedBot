/** PM2 process manager config — use `npm run pm2:start` after `npm run build`. */
module.exports = {
  apps: [
    {
      name: "ned-bot",
      script: "build/main.js",
      cwd: __dirname,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
      },
      error_file: "logs/pm2-error.log",
      out_file: "logs/pm2-out.log",
      merge_logs: true,
      time: true,
    },
  ],
};
