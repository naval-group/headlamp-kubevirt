import {
  Link,
  SectionBox,
  SectionFilterHeader,
  Table,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Chip, Typography } from '@mui/material';
import useFilteredList from '../../hooks/useFilteredList';
import useResourceActions from '../../hooks/useResourceActions';
import BulkDeleteToolbar from '../common/BulkDeleteToolbar';
import StandardRowActions from '../common/StandardRowActions';
import IPAMClaim from './IPAMClaim';

type IPAMClaimInstance = InstanceType<typeof IPAMClaim>;

export default function IPAMClaimList() {
  const { items: rawItems } = IPAMClaim.useList();
  const items = useFilteredList(rawItems);
  const { setEditItem, setViewYamlItem, setDeleteItem, ActionDialogs } =
    useResourceActions<IPAMClaimInstance>({
      apiVersion: 'k8s.cni.cncf.io/v1alpha1',
      kind: 'IPAMClaim',
    });

  if (rawItems && rawItems.length === 0) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h6" color="text.secondary">
          No IPAMClaims Found
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          IPAMClaims are created automatically when VMs use networks with persistent IP allocation.
        </Typography>
      </Box>
    );
  }

  return (
    <>
      <SectionBox title={<SectionFilterHeader title="IPAMClaims" />}>
        <Table
          data={items ?? []}
          loading={items === null}
          enableRowActions
          enableRowSelection
          getRowId={(item: IPAMClaimInstance) =>
            item.metadata?.uid ?? `${item.getNamespace()}/${item.getName()}`
          }
          renderRowSelectionToolbar={({ table }) => (
            <BulkDeleteToolbar table={table} kind="IPAMClaim" />
          )}
          renderRowActionMenuItems={({
            row,
            closeMenu,
          }: {
            row: { original: IPAMClaimInstance };
            closeMenu: () => void;
          }) => [
            <StandardRowActions
              key="std"
              resource={row.original}
              closeMenu={closeMenu}
              onEdit={setEditItem}
              onViewYaml={setViewYamlItem}
              onDelete={setDeleteItem}
            />,
          ]}
          columns={[
            {
              id: 'name',
              header: 'Name',
              accessorFn: (item: IPAMClaimInstance) => item.getName(),
              Cell: ({ row }: { row: { original: IPAMClaimInstance } }) => (
                <Link
                  routeName="ipamclaim"
                  params={{
                    name: row.original.getName(),
                    namespace: row.original.getNamespace(),
                  }}
                >
                  {row.original.getName()}
                </Link>
              ),
            },
            {
              id: 'namespace',
              header: 'Namespace',
              accessorFn: (item: IPAMClaimInstance) => item.getNamespace(),
            },
            {
              id: 'network',
              header: 'Network',
              accessorFn: (item: IPAMClaimInstance) => item.getNetwork(),
            },
            {
              id: 'ips',
              header: 'IPs',
              accessorFn: (item: IPAMClaimInstance) => item.getIPs().join(', '),
              Cell: ({ row }: { row: { original: IPAMClaimInstance } }) => {
                const ips = row.original.getIPs();
                return ips.length > 0
                  ? ips.map((ip, i) => (
                      <Chip
                        key={i}
                        label={ip}
                        size="small"
                        variant="outlined"
                        sx={{ mr: 0.5, fontFamily: 'monospace' }}
                      />
                    ))
                  : '-';
              },
            },
            {
              id: 'vm',
              header: 'VM',
              accessorFn: (item: IPAMClaimInstance) => item.getOwnerVMName(),
              Cell: ({ row }: { row: { original: IPAMClaimInstance } }) => {
                const vm = row.original.getOwnerVMName();
                return vm !== '-' ? (
                  <Link
                    routeName="virtualmachine"
                    params={{
                      name: vm,
                      namespace: row.original.getNamespace(),
                    }}
                  >
                    {vm}
                  </Link>
                ) : (
                  '-'
                );
              },
            },
            {
              id: 'pod',
              header: 'Pod',
              accessorFn: (item: IPAMClaimInstance) => item.getOwnerPodName(),
            },
            {
              id: 'age',
              header: 'Age',
              accessorFn: (item: IPAMClaimInstance) => item.getAge(),
            },
          ]}
        />
      </SectionBox>
      {ActionDialogs}
    </>
  );
}
