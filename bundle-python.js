#!/usr/bin/env node
const path = require("path");
const platform = process.platform;

// Route to the correct bundler:
// - macOS (darwin): use python-build-standalone (no .framework)
// - others: keep existing bundlers
if (platform === "darwin") {
  require(path.resolve(__dirname, "build-python-bundle-pbs.js"));
} else {
  require(path.resolve(__dirname, "build-python-bundle.js"));
}
