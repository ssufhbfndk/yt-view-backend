module.exports = {
  apps: [
    {
      name: "ythub", // Use same name here for pm2 logs etc.
      script: "./index.js",
      instances: 1,
      exec_mode: "fork",
      watch: true,
      ignore_watch: ["node_modules", "logs"],
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000  
    }
  ]
};
