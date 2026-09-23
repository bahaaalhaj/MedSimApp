import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: ['backend/**', 'dist/**', 'node_modules/**', 'src/data/**'],
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}', 'scripts/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'no-constant-binary-expression': 'error',
      'no-debugger': 'error',
    },
  },
];
