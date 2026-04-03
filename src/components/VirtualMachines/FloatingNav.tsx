import { Icon } from '@iconify/react';
import { Box, IconButton, Tooltip } from '@mui/material';
import React, { useCallback, useEffect, useState } from 'react';

interface FloatingNavProps {
  sections: Array<{
    id: string;
    label: string;
    icon: string;
  }>;
  onTerminalClick?: () => void;
  onVNCClick?: () => void;
  onDoctorClick?: () => void;
}

export default function FloatingNav({
  sections,
  onTerminalClick,
  onVNCClick,
  onDoctorClick,
}: FloatingNavProps) {
  const [visible, setVisible] = useState(true);

  // Hide our sidebar when a Headlamp complementary view is active.
  // When a taskbar view (editor, logs, etc.) opens, a div with
  // role="complementary" becomes visible (display changes from "none"
  // to something else). We observe this to hide our floating nav.
  const checkVisibility = useCallback(() => {
    const complementaryDivs = document.querySelectorAll('[role="complementary"]');
    let anyVisible = false;
    complementaryDivs.forEach(el => {
      const style = getComputedStyle(el);
      if (style.display !== 'none') {
        anyVisible = true;
      }
    });
    setVisible(!anyVisible);
  }, []);

  useEffect(() => {
    checkVisibility();
    const observer = new MutationObserver(checkVisibility);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
    return () => observer.disconnect();
  }, [checkVisibility]);

  const scrollToSection = (sectionId: string) => {
    if (sectionId === 'info') {
      const mainContent = document.querySelector('main');
      const scrollableContainer = document.querySelector('[class*="MuiBox-root"]');

      if (mainContent) {
        mainContent.scrollTop = 0;
        mainContent.scrollTo?.({ top: 0, behavior: 'smooth' });
      }

      if (scrollableContainer) {
        scrollableContainer.scrollTop = 0;
        scrollableContainer.scrollTo?.({ top: 0, behavior: 'smooth' });
      }

      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      window.scrollTo({ top: 0, behavior: 'smooth' });

      document.querySelectorAll('*').forEach(el => {
        if ((el as HTMLElement).scrollTop > 0) {
          (el as HTMLElement).scrollTop = 0;
        }
      });

      return;
    }

    if (sectionId === 'terminal' && onTerminalClick) {
      onTerminalClick();
      return;
    }

    if (sectionId === 'vnc' && onVNCClick) {
      onVNCClick();
      return;
    }

    if (sectionId === 'doctor' && onDoctorClick) {
      onDoctorClick();
      return;
    }

    const element = document.getElementById(`section-${sectionId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (!visible) return null;

  return (
    <Box
      sx={{
        position: 'fixed',
        right: 16,
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: 1000,
        backgroundColor: 'background.paper',
        borderRadius: 2,
        boxShadow: 3,
        padding: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
      }}
    >
      {sections.map(section => (
        <Tooltip key={section.id} title={section.label} placement="left">
          <IconButton
            size="small"
            onClick={() => scrollToSection(section.id)}
            sx={{
              '&:hover': {
                backgroundColor: 'action.hover',
              },
            }}
          >
            <Icon icon={section.icon} width={20} height={20} />
          </IconButton>
        </Tooltip>
      ))}
    </Box>
  );
}
