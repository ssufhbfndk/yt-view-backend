const cluster = require('cluster'); // Fix: cluster ko import karna zaroori hai
const os = require('os');           // os module bhi chahiye to get CPU count

if (cluster.isMaster) {
  const numCPUs = os.cpus().length;
  console.log(`👑 Master ${process.pid} running with ${numCPUs} workers`);

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork(); // Har CPU ke liye ek worker fork karo
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`💀 Worker ${worker.process.pid} died (code: ${code}, signal: ${signal}), restarting...`);
    cluster.fork(); // Worker crash hone par restart karo
  });
} else {
  // Worker thread
  try {
    require('./server'); // Server code ko load karo
  } catch (err) {
    console.error("❌ Worker crashed due to error:", err);
  }
}
