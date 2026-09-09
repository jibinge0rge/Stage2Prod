const { defineConfig } = require('vitest/config');

process.env.LOG_LEVEL = 'silent';

module.exports = defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    hookTimeout: 10000,
    testTimeout: 10000,
  },
});
