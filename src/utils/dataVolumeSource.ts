export interface RegistryDataVolumeSource {
  source: {
    registry: {
      url: string;
      platform?: {
        architecture: string;
      };
    };
  };
}

export function buildRegistryDataVolumeSource(
  url: string,
  architecture?: string
): RegistryDataVolumeSource {
  return {
    source: {
      registry: {
        url,
        ...(architecture ? { platform: { architecture } } : {}),
      },
    },
  };
}
