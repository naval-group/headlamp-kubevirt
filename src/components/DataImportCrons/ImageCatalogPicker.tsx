import { Icon } from '@iconify/react';
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  InputAdornment,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { getFullCatalog } from '../../utils/catalogLoader';
import { filterCatalogImages, getHiddenImageIds } from '../../utils/catalogUtils';
import { CATALOG_CATEGORIES, CatalogImage, resolveTagValues } from './imageCatalog';

export interface CatalogSelection {
  registryUrl: string;
  storageSize: string;
  osLabel: string;
  defaultPreference?: string;
  managedDataSourceSuggestion: string;
  sourceType?: 'containerdisk' | 'http';
  httpUrl?: string;
}

interface ImageCatalogPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (selection: CatalogSelection) => void;
  /** Filter to only show images with this source type. If not set, show all. */
  allowedSourceTypes?: Array<'containerdisk' | 'http'>;
}

export default function ImageCatalogPicker({
  open,
  onClose,
  onSelect,
  allowedSourceTypes,
}: ImageCatalogPickerProps) {
  const [catalog, setCatalog] = useState<CatalogImage[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [selectedImage, setSelectedImage] = useState<CatalogImage | null>(null);
  const [selectedTag, setSelectedTag] = useState('');

  // Load full catalog (built-in + ConfigMap entries) when picker opens
  useEffect(() => {
    if (open) {
      getFullCatalog().then(setCatalog);
    }
  }, [open]);

  const hiddenIds = useMemo(() => getHiddenImageIds(), [catalog]);

  const filteredImages = useMemo(
    () =>
      filterCatalogImages(catalog, {
        search,
        categoryFilter,
        showHidden: false,
        hiddenIds,
        allowedSourceTypes,
      }),
    [catalog, search, categoryFilter, hiddenIds, allowedSourceTypes]
  );

  const handleSelect = (image: CatalogImage) => {
    setSelectedImage(image);
    setSelectedTag(image.defaultTag);
  };

  const handleConfirm = () => {
    if (!selectedImage) return;

    const tag = selectedTag || selectedImage.defaultTag;
    const resolved = resolveTagValues(selectedImage, tag);
    const isHttp = selectedImage.sourceType === 'http';
    // For HTTP sources, find the URL from extendedTags
    const httpUrl = isHttp ? selectedImage.extendedTags?.find(t => t.name === tag)?.url || '' : '';

    onSelect({
      registryUrl: isHttp ? '' : `docker://${selectedImage.registry}:${tag}`,
      storageSize: selectedImage.recommendedSize,
      osLabel: resolved.osLabel,
      defaultPreference: resolved.defaultPreference,
      managedDataSourceSuggestion: `${selectedImage.id}-${tag}`.replace(/[^a-z0-9-]/g, '-'),
      sourceType: selectedImage.sourceType || 'containerdisk',
      httpUrl,
    });
    handleClose();
  };

  const handleClose = () => {
    setSearch('');
    setCategoryFilter('all');
    setSelectedImage(null);
    setSelectedTag('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Icon icon="mdi:image-multiple" width={24} />
          <span>Image Catalog</span>
        </Box>
      </DialogTitle>
      <DialogContent>
        {/* Filters */}
        <Box sx={{ display: 'flex', gap: 2, mb: 2, mt: 1 }}>
          <TextField
            size="small"
            placeholder="Search images..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            sx={{ flex: 1 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Icon icon="mdi:magnify" />
                </InputAdornment>
              ),
            }}
          />
          <TextField
            size="small"
            select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="all">All Categories</MenuItem>
            {Object.entries(CATALOG_CATEGORIES).map(([key, label]) => (
              <MenuItem key={key} value={key}>
                {label}
              </MenuItem>
            ))}
          </TextField>
        </Box>

        {/* Image Grid */}
        <Grid container spacing={2}>
          {filteredImages.map(image => {
            const isSelected = selectedImage?.id === image.id;
            return (
              <Grid item xs={12} sm={6} md={4} key={image.id}>
                <Card
                  variant={isSelected ? 'elevation' : 'outlined'}
                  sx={{
                    height: '100%',
                    border: isSelected ? '2px solid' : undefined,
                    borderColor: isSelected ? 'primary.main' : undefined,
                  }}
                >
                  <CardActionArea
                    onClick={() => handleSelect(image)}
                    sx={{
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'stretch',
                    }}
                  >
                    <CardContent sx={{ flex: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Icon icon={image.icon} width={28} height={28} color={image.iconColor} />
                        <Typography variant="subtitle1" fontWeight="bold">
                          {image.name}
                        </Typography>
                      </Box>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                        {image.description}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        <Chip label={image.recommendedSize} size="small" variant="outlined" />
                        <Chip
                          label={CATALOG_CATEGORIES[image.category]}
                          size="small"
                          variant="outlined"
                          color={
                            image.category === 'testing'
                              ? 'warning'
                              : image.category === 'coreos'
                              ? 'info'
                              : 'default'
                          }
                        />
                      </Box>
                    </CardContent>
                  </CardActionArea>
                </Card>
              </Grid>
            );
          })}

          {filteredImages.length === 0 && (
            <Grid item xs={12}>
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <Typography color="text.secondary">No images match your search.</Typography>
              </Box>
            </Grid>
          )}
        </Grid>

        {/* Tag selector — shown when an image is selected */}
        {selectedImage && (
          <Box
            sx={{
              mt: 2,
              p: 2,
              border: 1,
              borderColor: 'primary.main',
              borderRadius: 1,
              bgcolor: 'action.hover',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
              <Icon icon={selectedImage.icon} width={22} color={selectedImage.iconColor} />
              <Typography variant="subtitle2" fontWeight="bold">
                {selectedImage.name}
              </Typography>
            </Box>

            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  size="small"
                  select
                  label="Tag / Version"
                  value={selectedTag}
                  onChange={e => setSelectedTag(e.target.value)}
                >
                  {selectedImage.tags.map(tag => (
                    <MenuItem key={tag} value={tag}>
                      {tag}
                      {tag === selectedImage.defaultTag ? ' (recommended)' : ''}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  size="small"
                  label={
                    selectedImage.sourceType === 'http'
                      ? 'Download URL (preview)'
                      : 'Registry URL (preview)'
                  }
                  value={
                    selectedImage.sourceType === 'http'
                      ? selectedImage.extendedTags?.find(
                          t => t.name === (selectedTag || selectedImage.defaultTag)
                        )?.url || ''
                      : `docker://${selectedImage.registry}:${
                          selectedTag || selectedImage.defaultTag
                        }`
                  }
                  InputProps={{ readOnly: true }}
                />
              </Grid>
              <Grid item xs={12}>
                {(() => {
                  const resolved = resolveTagValues(
                    selectedImage,
                    selectedTag || selectedImage.defaultTag
                  );
                  return (
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      <Chip
                        label={`Size: ${selectedImage.recommendedSize}`}
                        size="small"
                        icon={<Icon icon="mdi:harddisk" width={16} />}
                      />
                      <Chip
                        label={`OS: ${resolved.osLabel}`}
                        size="small"
                        icon={<Icon icon="mdi:label" width={16} />}
                      />
                      {resolved.defaultPreference && (
                        <Chip
                          label={`Preference: ${resolved.defaultPreference}`}
                          size="small"
                          icon={<Icon icon="mdi:tune" width={16} />}
                        />
                      )}
                    </Box>
                  );
                })()}
              </Grid>
            </Grid>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleConfirm}
          disabled={!selectedImage}
          startIcon={<Icon icon="mdi:check" />}
        >
          Use Image
        </Button>
      </DialogActions>
    </Dialog>
  );
}
