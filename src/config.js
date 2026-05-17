import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const CONFIG_FILE = '.safegit.yml';

export function configPath(cwd = process.cwd()) {
  return path.join(cwd, CONFIG_FILE);
}

export function readConfig(cwd = process.cwd()) {
  const file = configPath(cwd);
  if (!fs.existsSync(file)) return null;
  return YAML.parse(fs.readFileSync(file, 'utf8'));
}

export function writeConfig(config, cwd = process.cwd()) {
  fs.writeFileSync(configPath(cwd), YAML.stringify(config), 'utf8');
}

export function requireConfig(cwd = process.cwd()) {
  const config = readConfig(cwd);
  if (!config) throw new Error(`Missing ${CONFIG_FILE}. Run safegit init first.`);
  if (!config.safe?.address || !config.safe?.chainId || !config.safe?.threshold) {
    throw new Error(`${CONFIG_FILE} must include safe.address, safe.chainId, and safe.threshold`);
  }
  return config;
}
