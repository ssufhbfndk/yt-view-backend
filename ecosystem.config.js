module.exports = {
  apps: [
    {
<<<<<<< HEAD
      name: "ythub", // Use same name here for pm2 logs etc.
      script: "./index.js",
      instances: 1,
      exec_mode: "fork",
      watch: true,
      ignore_watch: ["node_modules", "logs"],
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000
=======
      name: "ythub",
      script: "./index.js",
      instances: 1,          
      exec_mode: "fork",     
      watch: true,           
      ignore_watch: ["node_modules", "logs"], 
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000    
>>>>>>> a9bf0b7d739c50c8081da13af45c39a9f357c5bb
    }
  ]
};
