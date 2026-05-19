import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const cwd = process.cwd();
const distDir = path.join(cwd, 'dist');
const requiredFiles = [
  path.join(distDir, 'index.html'),
  path.join(distDir, 'assets', 'index.js'),
  path.join(distDir, 'assets', 'danmaku-chat.js'),
];
const assetsDir = path.join(distDir, 'assets');

function hasUsableDist() {
  if (!requiredFiles.every((file) => existsSync(file))) {
    return false;
  }
  if (!existsSync(assetsDir)) {
    return false;
  }
  return readdirSync(assetsDir).some((name) => name !== '.gitkeep');
}

if (hasUsableDist()) {
  console.log('dist resources already present');
  process.exit(0);
}

console.log('dist resources missing, generating frontend assets...');

const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:dist'], {
  cwd,
  env: process.env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
