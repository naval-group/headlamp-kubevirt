import { Icon } from '@iconify/react';
import { Link } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { MainInfoSection, SectionBox } from '@kinvolk/headlamp-plugin/lib/components/common';
import { Box, Chip, Grid, Typography } from '@mui/material';
import React from 'react';
import { useParams } from 'react-router-dom';
import IPAMClaim from './IPAMClaim';

export default function IPAMClaimDetails() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const [item] = IPAMClaim.useGet(name, namespace);

  if (!item) return null;

  const ownerVM = item.getOwnerVMName();
  const ownerRef = item.metadata?.ownerReferences?.[0];

  return (
    <Box p={2}>
      <MainInfoSection
        resource={item}
        extraInfo={[
          {
            name: 'Network',
            value: item.getNetwork(),
          },
          {
            name: 'Interface',
            value: item.getInterface(),
          },
          {
            name: 'IPs',
            value: (
              <Box display="flex" gap={0.5} flexWrap="wrap">
                {item.getIPs().length > 0
                  ? item
                      .getIPs()
                      .map((ip, i) => (
                        <Chip key={i} label={ip} size="small" sx={{ fontFamily: 'monospace' }} />
                      ))
                  : '-'}
              </Box>
            ),
          },
          {
            name: 'Owner VM',
            value:
              ownerVM !== '-' ? (
                <Link
                  routeName="virtualmachine"
                  params={{ namespace: item.getNamespace(), name: ownerVM }}
                >
                  {ownerVM}
                </Link>
              ) : (
                '-'
              ),
          },
          {
            name: 'Owner Pod',
            value: item.getOwnerPodName(),
          },
        ]}
      />

      {ownerRef && (
        <SectionBox title="Owner Reference">
          <Grid container spacing={2} p={2}>
            <Grid item xs={3}>
              <Typography variant="body2" color="text.secondary">
                Kind
              </Typography>
              <Typography variant="body1">{ownerRef.kind}</Typography>
            </Grid>
            <Grid item xs={3}>
              <Typography variant="body2" color="text.secondary">
                Name
              </Typography>
              <Typography variant="body1">{ownerRef.name}</Typography>
            </Grid>
            <Grid item xs={3}>
              <Typography variant="body2" color="text.secondary">
                API Version
              </Typography>
              <Typography variant="body1">{ownerRef.apiVersion}</Typography>
            </Grid>
            <Grid item xs={3}>
              <Typography variant="body2" color="text.secondary">
                Controller
              </Typography>
              <Typography variant="body1">
                {ownerRef.controller ? (
                  <Icon icon="mdi:check" color="#4caf50" />
                ) : (
                  <Icon icon="mdi:close" color="#f44336" />
                )}
              </Typography>
            </Grid>
          </Grid>
        </SectionBox>
      )}

      <SectionBox title="Finalizers">
        <Box p={2} display="flex" gap={0.5} flexWrap="wrap">
          {(item.metadata?.finalizers || []).map((f: string, i: number) => (
            <Chip key={i} label={f} size="small" variant="outlined" />
          ))}
          {(!item.metadata?.finalizers || item.metadata.finalizers.length === 0) && (
            <Typography variant="body2" color="text.secondary">
              None
            </Typography>
          )}
        </Box>
      </SectionBox>
    </Box>
  );
}
