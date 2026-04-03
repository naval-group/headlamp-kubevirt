const path = require('path');

const reactPath = path.resolve(__dirname, '../node_modules/react');
const reactDomPath = path.resolve(__dirname, '../node_modules/react-dom');

module.exports = {
  stories: ['../src/**/*.stories.@(js|jsx|ts|tsx)'],
  addons: ['@storybook/addon-links'],
  staticDirs: ['./public'],
  core: {
    disableTelemetry: true,
  },
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  typescript: {
    check: false,
    reactDocgen: true,
  },
  async viteFinal(config) {
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...config.resolve.alias,
      react: reactPath,
      'react-dom': reactDomPath,
      'react/jsx-runtime': path.join(reactPath, 'jsx-runtime'),
      'react/jsx-dev-runtime': path.join(reactPath, 'jsx-dev-runtime'),
      'react-dom/client': path.join(reactDomPath, 'client'),
      'react-dom/test-utils': path.join(reactDomPath, 'test-utils'),
    };

    config.optimizeDeps = config.optimizeDeps || {};
    config.optimizeDeps.include = [
      ...(config.optimizeDeps.include || []),
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      '@mui/material',
      '@mui/system',
      '@mui/styled-engine',
      '@mui/private-theming',
      '@mui/utils',
      '@mui/base',
      '@emotion/react',
      '@emotion/styled',
      'hoist-non-react-statics',
      'notistack',
      'prop-types',
      'clsx',
      '@iconify/react',
    ];

    return config;
  },
};
