#!/usr/bin/env node
// Standalone script to cleanup existing python_runtime_bundle
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const sitePackagesDir = path.join(__dirname, 'python_runtime_bundle/pbs/python/lib/python3.12/site-packages');

if (!fs.existsSync(sitePackagesDir)) {
  console.log('Site-packages not found at:', sitePackagesDir);
  process.exit(1);
}

console.log('Cleaning up site-packages to reduce bundle size...');
let savedBytes = 0;

// Directories to remove entirely from torch (not needed for inference)
// NOTE: Do NOT remove "bin" - it contains torch_shm_manager needed at runtime
// NOTE: Do NOT remove "testing" - torch.testing is imported by torch.autograd
const torchCleanupDirs = [
  'include',      // C++ headers (59MB)
  'share',        // Data files
];

const torchDir = path.join(sitePackagesDir, 'torch');
if (fs.existsSync(torchDir)) {
  for (const dir of torchCleanupDirs) {
    const dirPath = path.join(torchDir, dir);
    if (fs.existsSync(dirPath)) {
      try {
        const size = execSync(`du -sk "${dirPath}"`, { encoding: 'utf8' });
        const kb = parseInt(size.split('\t')[0], 10) || 0;
        fs.rmSync(dirPath, { recursive: true, force: true });
        savedBytes += kb * 1024;
        console.log(`  Removed torch/${dir} (~${Math.round(kb / 1024)}MB)`);
      } catch (e) {
        console.warn(`  Could not remove torch/${dir}:`, e.message);
      }
    }
  }
}

// Packages to remove entirely (not needed at runtime)
const packagesToRemove = ['pip', 'setuptools', 'wheel', 'pkg_resources'];

for (const pkg of packagesToRemove) {
  const pkgDir = path.join(sitePackagesDir, pkg);
  if (fs.existsSync(pkgDir)) {
    try {
      const size = execSync(`du -sk "${pkgDir}"`, { encoding: 'utf8' });
      const kb = parseInt(size.split('\t')[0], 10) || 0;
      fs.rmSync(pkgDir, { recursive: true, force: true });
      savedBytes += kb * 1024;
      console.log(`  Removed ${pkg}/ (~${Math.round(kb / 1024)}MB)`);
    } catch (e) {
      console.warn(`  Could not remove ${pkg}:`, e.message);
    }
  }
  // Also remove dist-info
  try {
    const distInfos = fs.readdirSync(sitePackagesDir).filter(
      (f) => f.startsWith(pkg) && f.endsWith('.dist-info')
    );
    for (const di of distInfos) {
      fs.rmSync(path.join(sitePackagesDir, di), { recursive: true, force: true });
    }
  } catch {}
}

// Remove test directories from all packages
const testDirNames = ['tests', 'test', 'testing', '_tests'];
function removeTestDirs(dir, depth = 0) {
  if (depth > 3) return;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(dir, entry.name);
      if (testDirNames.includes(entry.name)) {
        try {
          const size = execSync(`du -sk "${fullPath}"`, { encoding: 'utf8' });
          const kb = parseInt(size.split('\t')[0], 10) || 0;
          if (kb > 100) {
            fs.rmSync(fullPath, { recursive: true, force: true });
            savedBytes += kb * 1024;
            const relPath = fullPath.replace(sitePackagesDir + '/', '');
            console.log(`  Removed ${relPath}/ (~${Math.round(kb / 1024)}MB)`);
          } else {
            fs.rmSync(fullPath, { recursive: true, force: true });
            savedBytes += kb * 1024;
          }
        } catch {}
      } else {
        removeTestDirs(fullPath, depth + 1);
      }
    }
  } catch {}
}
removeTestDirs(sitePackagesDir);

// Remove __pycache__ directories
function removePycache(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.name === '__pycache__') {
        try {
          const size = execSync(`du -sk "${fullPath}"`, { encoding: 'utf8' });
          const kb = parseInt(size.split('\t')[0], 10) || 0;
          fs.rmSync(fullPath, { recursive: true, force: true });
          savedBytes += kb * 1024;
        } catch {}
      } else {
        removePycache(fullPath);
      }
    }
  } catch {}
}
removePycache(sitePackagesDir);

// Remove *.dist-info directories
try {
  const distInfoDirs = fs.readdirSync(sitePackagesDir).filter(
    (f) => f.endsWith('.dist-info')
  );
  for (const di of distInfoDirs) {
    try {
      const fullPath = path.join(sitePackagesDir, di);
      const size = execSync(`du -sk "${fullPath}"`, { encoding: 'utf8' });
      const kb = parseInt(size.split('\t')[0], 10) || 0;
      fs.rmSync(fullPath, { recursive: true, force: true });
      savedBytes += kb * 1024;
    } catch {}
  }
  if (distInfoDirs.length > 0) {
    console.log(`  Removed ${distInfoDirs.length} .dist-info directories`);
  }
} catch {}

const savedMB = Math.round(savedBytes / (1024 * 1024));
console.log(`\nCleanup complete! Saved approximately ${savedMB}MB`);
