import { Alert, Box, Button, Typography } from '@mui/material';
import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('KubeVirt plugin error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box p={3}>
          <Alert
            severity="error"
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => this.setState({ hasError: false, error: null })}
              >
                Retry
              </Button>
            }
          >
            <Typography variant="subtitle1">Something went wrong</Typography>
            <Typography variant="body2" color="text.secondary">
              An error occurred while rendering this view. Check the browser console for details.
            </Typography>
          </Alert>
        </Box>
      );
    }

    return this.props.children;
  }
}
