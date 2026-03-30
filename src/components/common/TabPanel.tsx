import { Icon } from '@iconify/react';
import { Box, Tab, Tabs, Tooltip } from '@mui/material';
import React from 'react';

export interface TabDef {
  icon: string;
  label: string;
  disabled?: boolean;
  reason?: string;
}

interface TabPanelHeaderProps {
  tabs: TabDef[];
  activeTab: number;
  onChange: (index: number) => void;
}

/** Renders a scrollable tab bar with icons, disabled states, and tooltip reasons. */
export function TabPanelHeader({ tabs, activeTab, onChange }: TabPanelHeaderProps) {
  return (
    <Tabs
      value={activeTab}
      onChange={(_, v) => {
        if (!tabs[v].disabled) onChange(v);
      }}
      variant="scrollable"
      scrollButtons="auto"
    >
      {tabs.map((tab, i) => (
        <Tab
          key={i}
          icon={<Icon icon={tab.icon} width={18} />}
          iconPosition="start"
          label={
            <Tooltip title={tab.disabled ? tab.reason || '' : ''} arrow placement="bottom">
              <Box display="flex" alignItems="center" gap={0.5}>
                {tab.label}
                {tab.disabled && (
                  <Icon icon="mdi:information-outline" width={14} style={{ opacity: 0.7 }} />
                )}
              </Box>
            </Tooltip>
          }
          sx={tab.disabled ? { opacity: 0.4, cursor: 'default' } : undefined}
        />
      ))}
    </Tabs>
  );
}

interface TabContentProps {
  activeTab: number;
  index: number;
  /** If true, use display:none instead of unmounting (preserves state). */
  keepAlive?: boolean;
  /** Flex layout for terminal/log-like tabs. */
  flex?: boolean;
  children: React.ReactNode;
}

/** Conditionally renders or hides tab content. */
export function TabContent({ activeTab, index, keepAlive, flex, children }: TabContentProps) {
  const panelProps = {
    role: 'tabpanel' as const,
    'aria-hidden': activeTab !== index,
    id: `tabpanel-${index}`,
    'aria-labelledby': `tab-${index}`,
  };

  if (keepAlive) {
    return (
      <Box
        {...panelProps}
        sx={{
          display: activeTab === index ? (flex ? 'flex' : 'block') : 'none',
          ...(flex && { flexDirection: 'column', flex: 1, minHeight: 0 }),
        }}
      >
        {children}
      </Box>
    );
  }

  if (activeTab !== index) return null;

  if (flex) {
    return (
      <Box {...panelProps} sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {children}
      </Box>
    );
  }

  return (
    <Box {...panelProps} component="div">
      {children}
    </Box>
  );
}
