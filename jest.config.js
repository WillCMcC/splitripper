/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/electron/**/*.test.js'],
  collectCoverageFrom: [
    'main.js',
    'preload.js',
    'electron/**/*.js',
  ],
  coverageDirectory: 'coverage/electron',
  modulePathIgnorePatterns: ['<rootDir>/dist/', '<rootDir>/python_runtime_bundle/'],
};
