import { useState, type ComponentType, type ReactElement } from 'react'
import ContentCutIcon from '@mui/icons-material/ContentCut'
import FileCopyIcon from '@mui/icons-material/FileCopy'
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibrary'
import PlaylistPlayIcon from '@mui/icons-material/PlaylistPlay'
import SettingsIcon from '@mui/icons-material/Settings'
import VideoLibraryIcon from '@mui/icons-material/VideoLibrary'
import Box from '@mui/material/Box'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import CutterScreen from '@renderer/features/cutter/CutterScreen'
import DuplicatesScreen from '@renderer/features/duplicates/DuplicatesScreen'
import ImageTriageScreen from '@renderer/features/imageTriage/ImageTriageScreen'
import JobsScreen from '@renderer/features/jobs/JobsScreen'
import SettingsScreen from '@renderer/features/settings/SettingsScreen'
import VideoTriageScreen from '@renderer/features/videoTriage/VideoTriageScreen'

type WorkspaceId = 'videoTriage' | 'imageTriage' | 'cutter' | 'jobs' | 'duplicates' | 'settings'

interface Workspace {
  id: WorkspaceId
  label: string
  icon: ReactElement
  Screen: ComponentType
}

const WORKSPACES: readonly Workspace[] = [
  { id: 'videoTriage', label: 'Video Triage', icon: <VideoLibraryIcon />, Screen: VideoTriageScreen },
  { id: 'imageTriage', label: 'Image Triage', icon: <PhotoLibraryIcon />, Screen: ImageTriageScreen },
  { id: 'cutter', label: 'Cutter', icon: <ContentCutIcon />, Screen: CutterScreen },
  { id: 'jobs', label: 'Jobs', icon: <PlaylistPlayIcon />, Screen: JobsScreen },
  { id: 'duplicates', label: 'Duplicates', icon: <FileCopyIcon />, Screen: DuplicatesScreen },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon />, Screen: SettingsScreen }
]

const NAV_WIDTH = 176

/** Application shell: workspace navigation on the left, the active workspace on the right. */
export default function App() {
  const [activeId, setActiveId] = useState<WorkspaceId>('videoTriage')
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
          {WORKSPACES.map(({ id, label, icon }) => (
            <ListItemButton
              key={id}
              selected={id === activeId}
              aria-current={id === activeId ? 'page' : undefined}
              onClick={() => setActiveId(id)}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>{icon}</ListItemIcon>
              <ListItemText primary={label} />
            </ListItemButton>
          ))}
        </List>
      </Box>
      <Box component="main" sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' }}>
        <Screen />
      </Box>
    </Box>
  )
}
