/**
 * CollapsiblePanel
 *
 * Generic one-line collapsible section used on the main stage to keep the
 * right column compact. Collapsed state shows the title plus a hint.
 */
import { useState, type ReactNode } from 'react';
import {
  Box,
  Collapse,
  IconButton,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

interface CollapsiblePanelProps {
  /** Section title shown on the collapsed header line. */
  title: string;
  /** Short hint rendered next to the title when collapsed. */
  hint?: string;
  defaultExpanded?: boolean;
  children: ReactNode;
}

export function CollapsiblePanel({
  title,
  hint,
  defaultExpanded = false,
  children,
}: CollapsiblePanelProps): JSX.Element {
  const [expanded, setExpanded] = useState<boolean>(defaultExpanded);
  return (
    <Paper elevation={3} sx={{ p: 1.5, mb: 1 }}>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        onClick={() => setExpanded((v) => !v)}
        sx={{ cursor: 'pointer', userSelect: 'none' }}
      >
        <Typography variant="subtitle2" sx={{ whiteSpace: 'nowrap' }}>
          ⚙ {title}
        </Typography>
        {!expanded && hint && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {hint}
          </Typography>
        )}
        {expanded && <Box sx={{ flexGrow: 1 }} />}
        <IconButton
          size="small"
          aria-label={expanded ? '收起' : '展开'}
          sx={{
            transform: expanded ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s',
          }}
        >
          <ExpandMoreIcon />
        </IconButton>
      </Stack>
      <Collapse in={expanded}>
        <Box sx={{ mt: expanded ? 1 : 0 }}>{children}</Box>
      </Collapse>
    </Paper>
  );
}
