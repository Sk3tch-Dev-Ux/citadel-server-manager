module.exports = {
  testEnvironment: 'node',
  collectCoverageFrom: [
    'lib/**/*.js',
    'routes/**/*.js',
    '!node_modules/**',
  ],
  testMatch: ['**/*.test.js'],
  forceExit: true,
  detectOpenHandles: true,
  // Don't transform node_modules
  transformIgnorePatterns: [
    'node_modules/',
  ],
  moduleNameMapper: {},
};
