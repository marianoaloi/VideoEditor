import { lazy, Suspense, type ComponentType, type LazyExoticComponent, type ReactElement } from 'react'
import ContentCutIcon from '@mui/icons-material/ContentCut'
import FileCopyIcon from '@mui/icons-material/FileCopy'
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibrary'
import PlaylistPlayIcon from '@mui/icons-material/PlaylistPlay'
import SettingsIcon from '@mui/icons-material/Settings'
import VideoLibraryIcon from '@mui/icons-material/VideoLibrary'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import type { WorkspaceId } from '@shared/domain/keymap'
import { useAppDispatch, useAppSelector } from '@renderer/app/hooks'
import KeymapHost from '@renderer/app/keymap/KeymapHost'
import { workspaceActivated } from '@renderer/app/keymap/keymapSlice'
import NotificationsHost from '@renderer/app/notifications/NotificationsHost'

interface Workspace {
  id: WorkspaceId
  label: string
  icon: ReactElement
  /** Screens load on first visit; every screen is a default export. */
  Screen: LazyExoticComponent<ComponentType>
}

const WORKSPACES: readonly Workspace[] = [
  {
    id: 'videoTriage',
    label: 'Video Triage',
    icon: <VideoLibraryIcon />,
    Screen: lazy(() => import('@renderer/features/videoTriage/VideoTriageScreen'))
  },
  {
    id: 'imageTriage',
    label: 'Image Triage',
    icon: <PhotoLibraryIcon />,
    Screen: lazy(() => import('@renderer/features/imageTriage/ImageTriageScreen'))
  },
  {
    id: 'cutter',
    label: 'Cutter',
    icon: <ContentCutIcon />,
    Screen: lazy(() => import('@renderer/features/cutter/CutterScreen'))
  },
  {
    id: 'jobs',
    label: 'Jobs',
    icon: <PlaylistPlayIcon />,
    Screen: lazy(() => import('@renderer/features/jobs/JobsScreen'))
  },
  {
    id: 'duplicates',
    label: 'Duplicates',
    icon: <FileCopyIcon />,
    Screen: lazy(() => import('@renderer/features/duplicates/DuplicatesScreen'))
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: <SettingsIcon />,
    Screen: lazy(() => import('@renderer/features/settings/SettingsScreen'))
  }
]

const NAV_WIDTH = 176

/**
 * Application shell: workspace navigation on the left, the active workspace on the right.
 * The active workspace lives in the keymap slice so the keyboard (Alt+1..6) and the mouse agree,
 * and only the active screen is mounted (its keymap scope is registered only while shown).
 */
export default function App() {
  const dispatch = useAppDispatch()
  const activeId = useAppSelector((state) => state.keymap.activeWorkspace)
  const { Screen } = WORKSPACES.find((workspace) => workspace.id === activeId) ?? WORKSPACES[0]

  return (
    <Box sx={{ display: 'flex', height: '100%' }}>
      <Box
        component="nav"
        aria-label="Workspaces"
        sx={{
          width: NAV_WIDTH,
          flexShrink: 0,
          borderRight: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper'
        }}
      >
        <List disablePadding>
          {WORKSPACES.map(({ id, label, icon }, index) => (
            <ListItemButton
              key={id}
              selected={id === activeId}
              aria-current={id === activeId ? 'page' : undefined}
              title={`Ctrl+${String(index + 1)}`}
              onClick={() => dispatch(workspaceActivated(id))}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>{icon}</ListItemIcon>
              <ListItemText primary={label} />
            </ListItemButton>
          ))}
        </List>
      </Box>
      <Box component="main" sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' }}>
        <Suspense
          fallback={
            <Box sx={{ p: 2 }}>
              <CircularProgress size={20} aria-label="Loading workspace" />
            </Box>
          }
        >
          <Screen key={activeId} />
        </Suspense>
      </Box>
      <KeymapHost />
      <NotificationsHost />
    </Box>
  )
}
