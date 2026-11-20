const path = require('path');

module.exports = {
  extends: ['../local-web/.eslintrc.cjs'],
  parserOptions: {
    project: path.join(__dirname, 'tsconfig.eslint.json'),
  },
};
