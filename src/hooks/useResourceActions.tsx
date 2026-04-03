import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/lib/k8s/KubeObject';
import { useSnackbar } from 'notistack';
import { useCallback, useState } from 'react';
import ConfirmDialog from '../components/common/ConfirmDialog';
import ResourceEditorDialog from '../components/ResourceEditorDialog';
import { safeError } from '../utils/sanitize';

/**
 * Reusable hook providing Edit / View YAML / Delete state and dialogs for any KubeObject.
 *
 * Returns:
 *  - setEditItem, setViewYamlItem, setDeleteItem — pass these to StandardRowActions
 *  - ActionDialogs — render this JSX at the end of your component
 */
export default function useResourceActions<T extends KubeObject>({
  apiVersion,
  kind,
}: {
  apiVersion: string;
  kind: string;
}) {
  const { enqueueSnackbar } = useSnackbar();
  const [editItem, setEditItem] = useState<T | null>(null);
  const [viewYamlItem, setViewYamlItem] = useState<T | null>(null);
  const [deleteItem, setDeleteItem] = useState<T | null>(null);

  const handleDelete = useCallback(async () => {
    if (!deleteItem) return;
    const name = deleteItem.getName();
    setDeleteItem(null);
    try {
      await deleteItem.delete();
      enqueueSnackbar(`Deleted ${name}`, { variant: 'success' });
    } catch (e) {
      enqueueSnackbar(`Failed to delete ${name}: ${safeError(e, 'resource-delete')}`, {
        variant: 'error',
      });
    }
  }, [deleteItem, enqueueSnackbar]);

  const ActionDialogs = (
    <>
      <ConfirmDialog
        open={!!deleteItem}
        title={`Delete ${deleteItem?.getName() || ''}?`}
        message={`This will permanently delete ${kind} ${
          deleteItem?.getNamespace() ? deleteItem.getNamespace() + '/' : ''
        }${deleteItem?.getName() || ''}. This action cannot be undone.`}
        confirmLabel="Delete"
        onCancel={() => setDeleteItem(null)}
        onConfirm={handleDelete}
      />

      {editItem && (
        <ResourceEditorDialog
          open={!!editItem}
          onClose={() => setEditItem(null)}
          onSave={async updatedResource => {
            const resource = updatedResource as {
              kind: string;
              metadata: { name: string; namespace?: string };
            };
            if (!resource.kind || !resource.metadata?.name) {
              throw new Error('Invalid resource: missing kind or metadata.name');
            }
            await editItem.update(updatedResource as KubeObjectInterface);
          }}
          item={editItem.jsonData}
          title={editItem.getName()}
          apiVersion={apiVersion}
          kind={kind}
        />
      )}

      {viewYamlItem && (
        <ResourceEditorDialog
          open={!!viewYamlItem}
          onClose={() => setViewYamlItem(null)}
          onSave={async () => {}}
          item={viewYamlItem.jsonData}
          title={`${viewYamlItem.getName()} (read-only)`}
          apiVersion={apiVersion}
          kind={kind}
        />
      )}
    </>
  );

  return {
    setEditItem: setEditItem as (item: T) => void,
    setViewYamlItem: setViewYamlItem as (item: T) => void,
    setDeleteItem: setDeleteItem as (item: T) => void,
    ActionDialogs,
  };
}
