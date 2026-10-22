import { start } from './src/server.js';

start().catch(error => {
  console.error(error);
  process.exit(1);
});
