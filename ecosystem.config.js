module.exports = {
  apps: [
    {
      name: "myapp-cluster",
      script: "./index.js",
      instances: 1,          // sirf 1 instance of index.js, kyunki cluster aap khud kar rahe hain
      exec_mode: "fork",     // fork mode, cluster mode PM2 ko mat do yahan
      watch: true,           // file changes pe restart karna hai
      ignore_watch: ["node_modules", "logs"],  // in folders ko watch nahi karna
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000    // 3 sec delay agar restart hota hai
    }
  ]
};
