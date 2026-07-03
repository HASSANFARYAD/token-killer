#!/usr/bin/env node
import { main } from '../src/cli.js';

main(process.argv.slice(2)).catch((error) => {
  console.error(`[noisegate] ${error?.stack || error}`);
  process.exit(1);
});
