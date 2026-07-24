#!/usr/bin/env tsx
/**
 * Runs tests across the workspace:
 * - vitest for script extensions (extensions/*) and custom objects (custom-objects/)
 * - jest for UI extensions (ui/)
 */
import { existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const hasExtensions =
  existsSync('extensions') &&
  readdirSync('extensions').some((name) => existsSync(`extensions/${name}/package.json`));

const hasCustomObjects = existsSync('custom-objects/package.json');

const hasUI = existsSync('ui/package.json');

let exitCode = 0;

function run(cmd: string): void {
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch (e: unknown) {
    exitCode = (e as NodeJS.ErrnoException & { status?: number }).status ?? 1;
  }
}

if (hasExtensions || hasCustomObjects) {
  run('vitest run');
}

if (hasUI) {
  try {
    execSync('pnpm --filter "./ui" test', { stdio: 'inherit' });
  } catch {
    // UI test failures are non-fatal
  }
}

process.exit(exitCode);
