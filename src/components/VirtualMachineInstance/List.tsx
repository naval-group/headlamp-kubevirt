import {
  DateLabel,
  Link,
  SectionBox,
  SectionFilterHeader,
  Table,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Chip } from '@mui/material';
import useFilteredList from '../../hooks/useFilteredList';
import VirtualMachineInstance from './VirtualMachineInstance';

export default function VirtualMachineInstanceList() {
  const { items: rawItems } = VirtualMachineInstance.useList();
  const items = useFilteredList(rawItems);

  return (
    <SectionBox title={<SectionFilterHeader title="Virtual Machine Instances" />}>
      <Table
        data={items ?? []}
        loading={items === null}
        columns={[
          {
            id: 'name',
            header: 'Name',
            accessorFn: (vmi: VirtualMachineInstance) => vmi.getName(),
            Cell: ({ row }: { row: { original: VirtualMachineInstance } }) => (
              <Link
                routeName="virtualmachineinstance"
                params={{ name: row.original.getName(), namespace: row.original.getNamespace() }}
              >
                {row.original.getName()}
              </Link>
            ),
          },
          {
            id: 'namespace',
            header: 'Namespace',
            accessorFn: (vmi: VirtualMachineInstance) => vmi.getNamespace(),
          },
          {
            id: 'phase',
            header: 'Phase',
            accessorFn: (vmi: VirtualMachineInstance) => vmi.status?.phase || 'Unknown',
            Cell: ({ row }: { row: { original: VirtualMachineInstance } }) => {
              const phase = row.original.status?.phase || 'Unknown';
              const color =
                phase === 'Running'
                  ? 'success'
                  : phase === 'Succeeded'
                  ? 'info'
                  : phase === 'Failed'
                  ? 'error'
                  : 'default';
              return <Chip label={phase} size="small" color={color} />;
            },
          },
          {
            id: 'node',
            header: 'Node',
            accessorFn: (vmi: VirtualMachineInstance) => vmi.status?.nodeName || '',
            Cell: ({ row }: { row: { original: VirtualMachineInstance } }) =>
              row.original.status?.nodeName ? (
                <Link routeName="node" params={{ name: row.original.status.nodeName }}>
                  {row.original.status.nodeName}
                </Link>
              ) : (
                '-'
              ),
          },
          {
            id: 'ip',
            header: 'IP',
            accessorFn: (vmi: VirtualMachineInstance) => {
              const interfaces = vmi.status?.interfaces || [];
              for (const iface of interfaces) {
                if (iface.ipAddresses) {
                  const ip = iface.ipAddresses.find((addr: string) => !addr.startsWith('fe80::'));
                  if (ip) return ip;
                }
              }
              return '';
            },
          },
          {
            id: 'age',
            header: 'Age',
            accessorFn: (vmi: VirtualMachineInstance) => vmi.metadata?.creationTimestamp || '',
            Cell: ({ row }: { row: { original: VirtualMachineInstance } }) => {
              const ts = row.original.metadata?.creationTimestamp;
              return ts ? <DateLabel date={ts} /> : '-';
            },
          },
        ]}
      />
    </SectionBox>
  );
}
