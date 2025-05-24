const cluster = require('cluster');
const os = require('os');

const numCPUs = os.cpus().length;

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);

  // Start 1 worker only for the job processor
  const jobWorker = cluster.fork({ ROLE: 'job' });

  // Start remaining workers for the API server
  for (let i = 1; i < numCPUs; i++) {
    cluster.fork({ ROLE: 'api' });
  }

  // Restart any worker if it dies
  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died. Restarting...`);

    // Recreate based on original role
    const role = worker.process.env.ROLE;
    cluster.fork({ ROLE: role });
  });

} else {
  const role = process.env.ROLE;

  if (role === 'job') {
    console.log(`Job worker ${process.pid} started`);
    require('./jobs/orderJob');
  } else {
    console.log(`API worker ${process.pid} started`);
    require('./server');
  }
}
