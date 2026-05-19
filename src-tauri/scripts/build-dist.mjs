import { spawn } from 'node:child_process';

const env = {
  ...process.env,
  NODE_OPTIONS: [process.env.NODE_OPTIONS, '--no-deprecation'].filter(Boolean).join(' '),
};

const child = spawn(process.execPath, ['./node_modules/vite/bin/vite.js', 'build'], {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

