#!/usr/bin/env node
const [major,minor]=process.versions.node.split('.').map(Number);
if(major!==24||minor<15) {
  console.error('NODE_VERSION: Please use Node.js >=24.15 <25.');
  process.exitCode=1;
} else {
  const {main}=await import('../src/cli.mjs');
  process.exitCode=await main();
}
