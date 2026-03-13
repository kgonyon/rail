import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { EnvFile } from '../types/config';

export function generateEnvFiles(
  worktreePath: string,
  envFiles: EnvFile[],
  ports: number[],
  secrets?: Record<string, string>,
): void {
  const portVars = buildPortVars(ports);

  for (const entry of envFiles) {
    const basePath = join(worktreePath, entry.path);
    processEnvFile(basePath, entry.source, entry.dest, entry.replace, portVars, secrets);
  }
}

/** @internal */
export function buildPortVars(ports: number[]): Record<string, string> {
  const vars: Record<string, string> = {};
  for (let i = 0; i < ports.length; i++) {
    vars[`RAIL_PORT_${i + 1}`] = String(ports[i]);
  }
  return vars;
}

function processEnvFile(
  basePath: string,
  source: string,
  dest: string,
  replace: Record<string, string>,
  portVars: Record<string, string>,
  secrets?: Record<string, string>,
): void {
  const sourcePath = join(basePath, source);
  const destPath = join(basePath, dest);

  if (!existsSync(sourcePath)) {
    throw new Error(`Env template not found: ${sourcePath}`);
  }

  let content = readFileSync(sourcePath, 'utf-8');
  content = applyReplacements(content, replace, portVars, secrets);

  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, content);
}

/** @internal */
export function applyReplacements(
  content: string,
  replace: Record<string, string>,
  portVars: Record<string, string>,
  secrets?: Record<string, string>,
): string {
  const lines = content.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    result.push(processLine(line, replace, portVars, secrets));
  }

  return result.join('\n');
}

/** @internal */
export function processLine(
  line: string,
  replace: Record<string, string>,
  portVars: Record<string, string>,
  secrets?: Record<string, string>,
): string {
  const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)/);
  if (!match) return line;

  const [, key] = match;

  if (secrets && key in secrets) {
    return `${key}=${secrets[key]}`;
  }

  if (key in replace) {
    const value = substitutePortVars(replace[key], portVars);
    return `${key}=${value}`;
  }

  return line;
}

/** @internal */
export function substitutePortVars(template: string, portVars: Record<string, string>): string {
  return template.replace(/\$\{(RAIL_PORT_\d+)\}/g, (_, varName) => {
    return portVars[varName] ?? `\${${varName}}`;
  });
}
