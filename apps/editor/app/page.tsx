'use client'

import {
  Editor,
  type SidebarTab,
  ViewerToolbarLeft,
  ViewerToolbarRight,
} from '@pascal-app/editor'
import { CFSRoot } from '@/cfs/components/CFSRoot'
import { ModeToggle } from '@/cfs/components/toolbar/ModeToggle'
import { OpeningToolbar } from '@/cfs/components/toolbar/OpeningToolbar'

const SIDEBAR_TABS: (SidebarTab & { component: React.ComponentType })[] = [
  {
    id: 'site',
    label: 'Scene',
    component: () => null, // Built-in SitePanel handles this
  },
]

export default function Home() {
  return (
    <div className="h-screen w-screen">
      <CFSRoot />
      <Editor
        layoutVersion="v2"
        projectId="local-editor"
        sidebarTabs={SIDEBAR_TABS}
        viewerToolbarLeft={<ViewerToolbarLeft />}
        viewerToolbarRight={
          <>
            <ViewerToolbarRight />
            <OpeningToolbar />
            <ModeToggle />
          </>
        }
      />
    </div>
  )
}
