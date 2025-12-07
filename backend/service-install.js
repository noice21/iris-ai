import { Service } from 'node-windows';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create a new service object
const svc = new Service({
  name: 'Iris AI',
  description: 'Iris AI Backend Service - Voice assistant with memory',
  script: join(__dirname, 'src', 'server', 'index.js'),
  nodeOptions: [],
  workingDirectory: __dirname,
  env: [
    {
      name: 'NODE_ENV',
      value: 'production'
    }
  ]
});

// Listen for the "install" event
svc.on('install', function() {
  console.log('Iris AI service installed successfully!');
  console.log('Starting service...');
  svc.start();
});

svc.on('start', function() {
  console.log('Iris AI service started!');
  console.log('Service is now running in the background.');
});

svc.on('alreadyinstalled', function() {
  console.log('Iris AI service is already installed.');
});

svc.on('error', function(err) {
  console.error('Error:', err);
});

// Install the service
console.log('Installing Iris AI as Windows service...');
svc.install();
