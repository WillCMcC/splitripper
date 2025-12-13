import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Default to jsdom for most frontend tests
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./tests/js/setup/dom-setup.js'],
        include: ['tests/js/**/*.test.js'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            include: ['src/public/app.js', 'src/public/constants.js', 'main.js', 'preload.js'],
        },
        // Allow tests to specify their own environment
        environmentMatchGlobs: [
            ['tests/js/unit/main.test.js', 'node'],
            ['tests/js/unit/**/*.test.js', 'jsdom'],
        ],
    },
});
