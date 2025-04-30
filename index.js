if (cluster.isMaster) {
  const numCPUs = os.cpus().length;
  console.log(`Master ${process.pid} running`);

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died (code: ${code}, signal: ${signal}), restarting...`);
    cluster.fork();
  });
} else {
  try {
    require('./server');
  } catch (err) {
    console.error("❌ Worker crashed due to error:", err);
  }
}
