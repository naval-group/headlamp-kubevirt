/**
 * Shared status-to-color mappings for VM phases and resource states.
 */

/** Map a VMI phase (Running, Paused, Failed, etc.) to a hex color. */
export function getVMIPhaseColor(phase: string): string {
  switch (phase?.toLowerCase()) {
    case 'running':
    case 'succeeded':
      return '#3e8635';
    case 'paused':
      return '#f0ab00';
    case 'scheduling':
    case 'scheduled':
    case 'starting':
      return '#2196f3';
    case 'failed':
    case 'crashloopbackoff':
      return '#c9190b';
    default:
      return '#6a6e73';
  }
}

/** Map a memory dump phase to a hex color. */
export function getDumpPhaseColor(phase: string): string {
  switch (phase) {
    case 'Completed':
      return '#3e8635';
    case 'InProgress':
      return '#2196f3';
    case 'Failed':
      return '#c9190b';
    case 'Dissociating':
      return '#f0ab00';
    default:
      return '#6a6e73';
  }
}

/** Map a memory dump phase to an icon name. */
export function getDumpPhaseIcon(phase: string): string {
  switch (phase) {
    case 'Completed':
      return 'mdi:check-circle';
    case 'InProgress':
      return 'mdi:progress-clock';
    case 'Failed':
      return 'mdi:alert-circle';
    case 'Dissociating':
      return 'mdi:link-off';
    default:
      return 'mdi:help-circle-outline';
  }
}

/** MUI Chip color for a VirtualMachineClone status. */
export type ChipColor = 'default' | 'primary' | 'success' | 'error' | 'warning';

export function getCloneStatusColor(status: string): ChipColor {
  switch (status) {
    case 'Succeeded':
      return 'success';
    case 'Failed':
      return 'error';
    case 'SnapshotInProgress':
    case 'RestoreInProgress':
    case 'InProgress':
      return 'primary';
    case 'CreatingTargetVM':
    case 'Pending':
      return 'warning';
    default:
      return 'default';
  }
}

/** Find a condition by type from a conditions array. */
export function findCondition<T extends { type: string }>(
  conditions: T[] | undefined | null,
  type: string
): T | undefined {
  return conditions?.find(c => c.type === type);
}

/** MUI Chip color for a VirtualMachineRestore status. */
export function getRestoreStatusColor(status: string): ChipColor {
  switch (status) {
    case 'Succeeded':
      return 'success';
    case 'Failed':
      return 'error';
    case 'InProgress':
      return 'primary';
    default:
      return 'default';
  }
}

/** Map an inspector VM status to a hex color. */
export function getInspectorStatusColor(
  status: 'idle' | 'creating' | 'pending' | 'running' | 'failed' | 'deleting'
): string {
  switch (status) {
    case 'creating':
      return '#42a5f5';
    case 'pending':
      return '#ffa726';
    case 'running':
      return '#66bb6a';
    case 'failed':
      return '#ef5350';
    case 'deleting':
      return '#ab47bc';
    default:
      return '#78909c';
  }
}

/** Map a PVC phase to a hex color. */
export function getPVCPhaseColor(phase: string): string {
  switch (phase) {
    case 'Bound':
      return '#3e8635';
    case 'Pending':
      return '#f0ab00';
    case 'Lost':
      return '#c9190b';
    default:
      return '#6a6e73';
  }
}
