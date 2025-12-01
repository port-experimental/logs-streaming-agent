module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/packages'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  collectCoverageFrom: [
    'packages/**/*.ts',
    '!packages/**/*.d.ts',
    '!packages/**/dist/**',
    '!packages/**/node_modules/**',
    '!packages/**/__tests__/**',
  ],
  moduleNameMapper: {
    '^@cicd/shared$': '<rootDir>/packages/shared/src',
    '^@cicd/shared/(.*)$': '<rootDir>/packages/shared/src/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
};

