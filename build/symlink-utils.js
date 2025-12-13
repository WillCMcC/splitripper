const fs = require("fs");
const path = require("path");

/**
 * Replace all symlinks under a directory with real files/dirs
 * to avoid electron-builder ensureSymlink issues
 * @param {string} root - Root directory to process
 */
function materializeAllSymlinks(root) {
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const p = path.join(d, ent.name);
      try {
        const st = fs.lstatSync(p);
        if (st.isSymbolicLink()) {
          let target;
          try {
            target = fs.realpathSync(p);
          } catch (e) {
            console.warn("Broken symlink (skipping):", p, e.message);
            try {
              fs.rmSync(p, { recursive: true, force: true });
            } catch {}
            continue;
          }
          try {
            fs.rmSync(p, { recursive: true, force: true });
          } catch {}
          try {
            const tStat = fs.statSync(target);
            if (tStat.isDirectory()) {
              fs.cpSync(target, p, { recursive: true });
            } else {
              fs.copyFileSync(target, p);
            }
          } catch (e) {
            console.warn(
              "Failed to materialize symlink:",
              p,
              "->",
              target,
              e.message
            );
          }
        } else if (st.isDirectory()) {
          stack.push(p);
        }
      } catch {}
    }
  }
}

module.exports = {
  materializeAllSymlinks,
};
