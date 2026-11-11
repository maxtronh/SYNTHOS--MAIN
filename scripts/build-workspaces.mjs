import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const workspaceRoots = ['backend', 'frontend'];
const packages = new Map();

for (const root of workspaceRoots) {
  if (!fs.existsSync(root)) continue;
  for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const pkgPath = path.join(root, dir.name);
    const pkgJsonPath = path.join(pkgPath, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) continue;

    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    packages.set(pkgJson.name, {
      name: pkgJson.name,
      path: pkgPath,
      deps: Object.keys(pkgJson.dependencies ?? {}),
    });
  }
}

// Topological sort (Kahn's algorithm) across internal workspace dependencies
const inDegree = new Map();
const dependents = new Map();

for (const [name, pkg] of packages.entries()) {
  const internalDeps = pkg.deps.filter(d => packages.has(d));
  inDegree.set(name, internalDeps.length);
  for (const dep of internalDeps) {
    const list = dependents.get(dep) ?? [];
    list.push(name);
    dependents.set(dep, list);
  }
}

const queue = [];
for (const [name, deg] of inDegree.entries()) {
  if (deg === 0) queue.push(name);
}

const order = [];
while (queue.length > 0) {
  queue.sort();
  const curr = queue.shift();
  order.push(curr);
  for (const next of dependents.get(curr) ?? []) {
    const deg = inDegree.get(next) - 1;
    inDegree.set(next, deg);
    if (deg === 0) queue.push(next);
  }
}

if (order.length !== packages.size) {
  throw new Error('Cyclic workspace dependency detected during build.');
}

for (const name of order) {
  const pkg = packages.get(name);
  console.log(`Building ${name} (${pkg.path})...`);
  execSync('npx tsc -b', { cwd: pkg.path, stdio: 'inherit' });
}

console.log(`\nSuccessfully built all ${order.length} workspace packages in topological order.`);
