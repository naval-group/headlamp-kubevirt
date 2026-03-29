import React from 'react';
import { initialize, mswLoader } from 'msw-storybook-addon';
import { baseMocks } from './baseMocks';
import { SnackbarProvider } from 'notistack';
import { BrowserRouter } from 'react-router-dom';

initialize({
  onUnhandledRequest: 'warn',
  waitUntilReady: true,
});

const withProviders = (Story: any) => (
  <BrowserRouter>
    <SnackbarProvider maxSnack={3} autoHideDuration={3000}>
      <div style={{ padding: '1rem' }}>
        <Story />
      </div>
    </SnackbarProvider>
  </BrowserRouter>
);

export const decorators = [withProviders];

export const parameters = {
  backgrounds: {
    values: [
      { name: 'light', value: '#ffffff' },
      { name: 'dark', value: '#1e1e1e' },
    ],
  },
  msw: {
    handlers: {
      base: baseMocks,
    },
  },
};

export const loaders = [mswLoader];
