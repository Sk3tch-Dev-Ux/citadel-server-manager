module.exports = {
  testEnvironment: 'node',
  collectCoverageFrom: [
    'lib/**/*.js',
    'routes/**/*.js',
    '!**/*.test.js',
    '!node_modules/**',
  ],
  // Low ratchet floor: prevents coverage from regressing below today's baseline.
  // Raise these numbers as the test suite grows (see docs/improvement-analysis).
  coverageThreshold: {
    global: {
      statements: 16,
      branches: 8,
      functions: 11,
      lines: 17,
    },
  },
  // Redirect the data dir to a temp location before any module loads, so tests
  // never read or pollute the real ./data (e.g. fail2ban ip-bans.json).
  setupFiles: ['<rootDir>/tests/setup-env.js'],
  testMatch: ['**/*.test.js'],
  forceExit: true,
  detectOpenHandles: true,
  // Don't transform node_modules
  transformIgnorePatterns: [
    'node_modules/',
  ],
  moduleNameMapper: {},
};
