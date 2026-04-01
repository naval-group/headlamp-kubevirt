import { Icon } from '@iconify/react';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { Divider, ListItemIcon, ListItemText, MenuItem } from '@mui/material';

/**
 * Standard Edit / View YAML / Delete menu items for any KubeObject list row.
 *
 * Usage:
 *   enableRowActions
 *   renderRowActionMenuItems={({ row, closeMenu }) => [
 *     <StandardRowActions key="std" resource={row.original} closeMenu={closeMenu}
 *       onEdit={setEditItem} onViewYaml={setViewYamlItem} onDelete={setDeleteItem} />
 *   ]}
 */
export default function StandardRowActions<T extends KubeObject>({
  resource,
  closeMenu,
  onEdit,
  onViewYaml,
  onDelete,
  extraItems,
}: {
  resource: T;
  closeMenu: () => void;
  onEdit: (item: T) => void;
  onViewYaml: (item: T) => void;
  onDelete: (item: T) => void;
  extraItems?: React.ReactNode;
}) {
  return (
    <>
      {extraItems}
      {extraItems && <Divider />}
      <MenuItem
        onClick={() => {
          closeMenu();
          onEdit(resource);
        }}
      >
        <ListItemIcon>
          <Icon icon="mdi:pencil" />
        </ListItemIcon>
        <ListItemText>Edit</ListItemText>
      </MenuItem>
      <MenuItem
        onClick={() => {
          closeMenu();
          onViewYaml(resource);
        }}
      >
        <ListItemIcon>
          <Icon icon="mdi:eye" />
        </ListItemIcon>
        <ListItemText>View YAML</ListItemText>
      </MenuItem>
      <MenuItem
        onClick={() => {
          closeMenu();
          onDelete(resource);
        }}
      >
        <ListItemIcon>
          <Icon icon="mdi:delete" />
        </ListItemIcon>
        <ListItemText>Delete</ListItemText>
      </MenuItem>
    </>
  );
}
