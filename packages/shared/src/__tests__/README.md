# Tests

This directory contains unit tests for the shared package.

## Running Tests

```bash
# Run all tests
yarn test

# Run tests in watch mode
yarn test:watch

# Run tests with coverage
yarn test:coverage

# Run tests from root
yarn workspace @cicd/shared test
```

## Test Structure

- `core/__tests__/` - Tests for core functionality (PluginRegistry, etc.)
- `providers/` - Tests for CI/CD provider implementations

## Writing Tests

Tests use Jest with TypeScript support. Example:

```typescript
import { MyClass } from '../MyClass';

describe('MyClass', () => {
  it('should do something', () => {
    const instance = new MyClass();
    expect(instance.method()).toBe(expected);
  });
});
```

