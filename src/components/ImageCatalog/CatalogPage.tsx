import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox, SectionFilterHeader } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  IconButton,
  InputAdornment,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import { useEffect, useMemo, useState } from 'react';
import useConfirmDialog from '../../hooks/useConfirmDialog';
import { getFullCatalog } from '../../utils/catalogLoader';
import {
  filterCatalogImages,
  getErrorMessage,
  getHiddenImageIds,
  isSafeIconUrl,
  safeIconColor,
  setHiddenImageIds,
} from '../../utils/catalogUtils';
import ConfirmDialog from '../common/ConfirmDialog';
import { CATALOG_CATEGORIES, CatalogCategory, CatalogImage } from '../DataImportCrons/imageCatalog';
import CreateCatalogEntryWizard from './CreateCatalogEntryWizard';

export default function CatalogPage() {
  const { enqueueSnackbar } = useSnackbar();
  const { dialogProps, confirm } = useConfirmDialog();
  const [catalog, setCatalog] = useState<CatalogImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<CatalogImage | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => getHiddenImageIds());
  const [showHidden, setShowHidden] = useState(false);

  const loadCatalog = async () => {
    setLoading(true);
    const entries = await getFullCatalog();
    setCatalog(entries);
    setLoading(false);
  };

  useEffect(() => {
    loadCatalog();
  }, []);

  const toggleHidden = (imageId: string) => {
    const next = new Set(hiddenIds);
    if (next.has(imageId)) {
      next.delete(imageId);
    } else {
      next.add(imageId);
    }
    setHiddenIds(next);
    setHiddenImageIds(next);
  };

  const hiddenCount = useMemo(
    () => catalog.filter(img => hiddenIds.has(img.id)).length,
    [catalog, hiddenIds]
  );

  const filteredCatalog = useMemo(
    () =>
      filterCatalogImages(catalog, {
        search,
        categoryFilter,
        showHidden,
        hiddenIds,
      }),
    [catalog, search, categoryFilter, showHidden, hiddenIds]
  );

  const handleDelete = (entry: CatalogImage) => {
    if (entry.source !== 'configmap' || !entry.sourceRef) return;
    const parts = entry.sourceRef.split('/');
    if (parts.length < 2 || !parts[0] || !parts[1]) return;
    const [ns, name] = parts;
    confirm({
      title: 'Delete Custom Image',
      message: `Delete "${entry.name}"? This will remove the ConfigMap and cannot be undone.`,
      confirmLabel: 'Delete',
      onConfirm: async () => {
        try {
          await ApiProxy.request(
            `/api/v1/namespaces/${encodeURIComponent(ns)}/configmaps/${encodeURIComponent(name)}`,
            { method: 'DELETE' }
          );
          enqueueSnackbar(`Image "${entry.name}" deleted`, { variant: 'success' });
          loadCatalog();
        } catch (err) {
          enqueueSnackbar(`Failed to delete: ${getErrorMessage(err)}`, { variant: 'error' });
        }
      },
    });
  };

  const renderIcon = (img: CatalogImage) => {
    if (img.iconUrl && isSafeIconUrl(img.iconUrl)) {
      return (
        <img
          src={img.iconUrl}
          alt={img.name}
          style={{ width: 32, height: 32, objectFit: 'contain' }}
        />
      );
    }
    return (
      <Icon
        icon={img.icon || 'mdi:package-variant'}
        width={32}
        style={{ color: safeIconColor(img.iconColor) }}
      />
    );
  };

  return (
    <>
      <SectionBox
        title={
          <SectionFilterHeader
            title="Image Catalog"
            titleSideActions={[
              <Button
                key="add"
                size="small"
                variant="contained"
                startIcon={<Icon icon="mdi:plus" width={16} />}
                onClick={() => setCreateOpen(true)}
              >
                Add Image
              </Button>,
            ]}
            noNamespaceFilter
            headerStyle="main"
          />
        }
      >
        {/* Filters */}
        <Box display="flex" gap={1} mb={2} alignItems="center" flexWrap="wrap">
          <TextField
            size="small"
            placeholder="Search images..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            sx={{ minWidth: 250 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Icon icon="mdi:magnify" width={20} />
                </InputAdornment>
              ),
            }}
          />
          {Object.entries(CATALOG_CATEGORIES).map(([key, label]) => (
            <Chip
              key={key}
              label={label}
              size="small"
              variant={categoryFilter === key ? 'filled' : 'outlined'}
              color={categoryFilter === key ? 'primary' : 'default'}
              onClick={() => setCategoryFilter(categoryFilter === key ? 'all' : key)}
              sx={{ cursor: 'pointer' }}
            />
          ))}
          {categoryFilter !== 'all' && (
            <Chip label="Clear" size="small" onDelete={() => setCategoryFilter('all')} />
          )}
          {hiddenCount > 0 && (
            <Box display="flex" alignItems="center" ml="auto">
              <Tooltip title={showHidden ? 'Hide hidden images' : 'Show hidden images'}>
                <Box display="flex" alignItems="center" gap={0.5}>
                  <Icon
                    icon={showHidden ? 'mdi:eye' : 'mdi:eye-off'}
                    width={18}
                    style={{ opacity: 0.6 }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {hiddenCount} hidden
                  </Typography>
                  <Switch
                    size="small"
                    checked={showHidden}
                    onChange={(_, checked) => setShowHidden(checked)}
                  />
                </Box>
              </Tooltip>
            </Box>
          )}
        </Box>

        {loading ? (
          <Typography color="text.secondary" textAlign="center" py={4}>
            Loading catalog...
          </Typography>
        ) : filteredCatalog.length === 0 ? (
          <Box textAlign="center" py={4}>
            <Icon icon="mdi:image-multiple" width={48} style={{ opacity: 0.3 }} />
            <Typography variant="h6" color="text.secondary" mt={1}>
              No images found
            </Typography>
          </Box>
        ) : (
          <Grid container spacing={2}>
            {filteredCatalog.map(img => (
              <Grid item xs={12} sm={6} md={4} lg={3} key={img.id}>
                <Card
                  variant="outlined"
                  sx={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    '&:hover': { borderColor: 'primary.main' },
                    ...(hiddenIds.has(img.id) && { opacity: 0.5 }),
                  }}
                >
                  <CardContent sx={{ flex: 1 }}>
                    <Box display="flex" alignItems="center" gap={1} mb={1}>
                      {renderIcon(img)}
                      <Box flex={1}>
                        <Typography variant="subtitle2" fontWeight={600}>
                          {img.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {img.description}
                        </Typography>
                      </Box>
                    </Box>

                    <Box display="flex" gap={0.5} flexWrap="wrap" mb={1}>
                      <Chip
                        label={CATALOG_CATEGORIES[img.category as CatalogCategory] || img.category}
                        size="small"
                        variant="outlined"
                      />
                      {img.source === 'builtin' && (
                        <Chip label="Built-in" size="small" color="info" variant="outlined" />
                      )}
                      {img.source === 'configmap' && (
                        <Tooltip title={`From ConfigMap: ${img.sourceRef}`}>
                          <Chip label="Custom" size="small" color="warning" variant="outlined" />
                        </Tooltip>
                      )}
                      {img.sourceType === 'http' && (
                        <Chip label="HTTP" size="small" variant="outlined" />
                      )}
                    </Box>

                    <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                      {img.tags.length} version{img.tags.length !== 1 ? 's' : ''} — Default:{' '}
                      <strong>{img.defaultTag}</strong>
                    </Typography>

                    <Box display="flex" gap={0.5} flexWrap="wrap">
                      {img.tags.slice(0, 5).map(tag => (
                        <Chip
                          key={tag}
                          label={tag}
                          size="small"
                          variant={tag === img.defaultTag ? 'filled' : 'outlined'}
                          color={tag === img.defaultTag ? 'primary' : 'default'}
                          sx={{ height: 20, fontSize: '0.7rem' }}
                        />
                      ))}
                      {img.tags.length > 5 && (
                        <Chip
                          label={`+${img.tags.length - 5}`}
                          size="small"
                          sx={{ height: 20, fontSize: '0.7rem' }}
                        />
                      )}
                    </Box>

                    <Box display="flex" gap={0.5} flexWrap="wrap" mt={1}>
                      <Chip
                        label={img.recommendedSize}
                        size="small"
                        variant="outlined"
                        sx={{ height: 18, fontSize: '0.65rem' }}
                      />
                      <Chip
                        label={img.osLabel}
                        size="small"
                        variant="outlined"
                        sx={{ height: 18, fontSize: '0.65rem' }}
                      />
                    </Box>
                  </CardContent>

                  <Box display="flex" justifyContent="flex-end" gap={0.5} px={1} pb={1}>
                    <Tooltip
                      title={hiddenIds.has(img.id) ? 'Show in pickers' : 'Hide from pickers'}
                    >
                      <IconButton
                        size="small"
                        onClick={() => toggleHidden(img.id)}
                        sx={{ opacity: hiddenIds.has(img.id) ? 1 : 0.4 }}
                      >
                        <Icon icon={hiddenIds.has(img.id) ? 'mdi:eye-off' : 'mdi:eye'} width={18} />
                      </IconButton>
                    </Tooltip>
                    {img.source === 'configmap' && (
                      <>
                        <Tooltip title="Edit custom image">
                          <IconButton size="small" onClick={() => setEditEntry(img)}>
                            <Icon icon="mdi:pencil" width={18} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete custom image">
                          <IconButton size="small" color="error" onClick={() => handleDelete(img)}>
                            <Icon icon="mdi:delete" width={18} />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}
                  </Box>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}
      </SectionBox>

      <ConfirmDialog {...dialogProps} />

      <CreateCatalogEntryWizard
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          loadCatalog();
        }}
      />

      <CreateCatalogEntryWizard
        open={!!editEntry}
        onClose={() => {
          setEditEntry(null);
          loadCatalog();
        }}
        initialEntry={editEntry}
      />
    </>
  );
}
