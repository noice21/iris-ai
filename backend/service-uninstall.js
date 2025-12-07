import { Service } from 'node-windows';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create a new service object
const svc = new Service({
  name: 'Iris AI',
  script: join(__dirname, 'src', 'server', 'index.js')
});

// Listen for the "uninstall" event
svc.on('uninstall', function() {
  console.log('Iris AI service uninstalled successfully!');
});

svc.on('stop', function() {
  console.log('Iris AI service stopped.');
});

svc.on('error', function(err) {
  console.error('Error:', err);
});

// Uninstall the service
console.log('Uninstalling Iris AI Windows service...');
svc.uninstall();
