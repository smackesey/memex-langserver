module.exports = {
  env: {
    browser: true,
    es6: true,
  },
  extends: [
    'airbnb-base',
  ],
  ignorePatterns: [
    'lib',
  ],
  globals: {
    Atomics: 'readonly',
    SharedArrayBuffer: 'readonly',
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2018,
    sourceType: 'module',
  },
  plugins: [
    '@typescript-eslint',
  ],
  settings: {
    'import/resolver': {
      node: {
        extensions: ['.ts'],
      },
    },
  },
  rules: {
    'arrow-parens': ['warn', 'as-needed'],
    'class-methods-use-this': 'off',
    'comma-dangle': 'warn',
    'func-names': ['warn', 'as-needed'],
    'function-paren-newline': 'off',
    'import/extensions': 'off',
    'import/prefer-default-export': 'warn',
    'implicit-arrow-linebreak': 'off',
    'indent': 'warn',
    'lines-between-class-members': ['warn', 'always', { exceptAfterSingleLine: true }],
    'max-classes-per-file': 'off',
    'max-len': 'off',
    'no-cond-assign': ['error', 'except-parens'],
    'no-else-return': 'off',
    'no-multi-spaces': ['error', { ignoreEOLComments: true }],
    'no-param-reassign': ['warn', { props: false }],
    'no-plusplus': ['warn', { allowForLoopAfterthoughts: true }],
    'no-restricted-syntax': ['error', 'ForInStatement', 'LabeledStatement'],
    'no-shadow': 'off',
    '@typescript-eslint/no-shadow': 'error',
    'no-use-before-define': 'off',
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^log$' }],
    'no-underscore-dangle': ['error', { allowAfterThis: true }],
    'object-curly-newline': 'off',
    'operator-linebreak': ['error', 'after'],
    'padded-blocks': 'off',
    'prefer-template': 'off',
    'quotes': ['warn'],
    'quote-props': ['warn', 'consistent-as-needed'],
  },
};
