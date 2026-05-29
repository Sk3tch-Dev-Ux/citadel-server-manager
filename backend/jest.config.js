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
      statements: 10,
      branches: 3,
      functions: 5,
      lines: 10,
    },
  },
  testMatch: ['**/*.test.js'],
  forceExit: true,
  detectOpenHandles: true,
  // Don't transform node_modules
  transformIgnorePatterns: [
    'node_modules/',
  ],
  moduleNameMapper: {},
};
