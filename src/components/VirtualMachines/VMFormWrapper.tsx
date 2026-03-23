/**
 * VMFormWrapper - Wrapper for VMFormFull to work with CreateResourceDialog
 */

import React from 'react';
import VMFormFull from './VMFormFull';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KubeResourceBuilder = Record<string, any>;

interface VMFormWrapperProps {
  resource: KubeResourceBuilder;
  onChange: (resource: KubeResourceBuilder) => void;
  editMode?: boolean;
  showErrors?: boolean;
}

export default function VMFormWrapper({
  resource,
  onChange,
  editMode,
  showErrors,
}: VMFormWrapperProps) {
  return (
    <VMFormFull
      resource={resource}
      onChange={onChange}
      editMode={editMode}
      showErrors={showErrors}
    />
  );
}
