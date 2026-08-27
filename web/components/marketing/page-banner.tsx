"use client"

import type { PageHead } from "@/lib/site-content"
import { MediaHero, PlateHero } from "@/components/marketing/bold-kit"
import { EditableImage, useEditableNum, useEditableSrc } from "@/components/marketing/edit-mode"

/**
 * ── A PAGE'S OPENING BLOCK ───────────────────────────────────────────────────────────────
 *
 * One line at a call site, in place of the eight it used to take: read the src through the
 * draft, read three adjustment numbers through the draft, derive four sibling content paths,
 * wrap the thing in an EditableImage and pass five props down. Every one of those steps is
 * mechanical and every one of them is a step a new page could get wrong — which is exactly
 * why, before this existed, three of nine pages had a picture slot and six had none.
 *
 * THE FALLBACK IS THE POINT. With no picture set it renders PlateHero — the flat plate every
 * page opens on today, unchanged. So converting a page cannot break it: the page keeps its
 * current appearance until somebody actually uploads something, and the upload is what turns
 * it into a full-bleed banner. There is no migration and no in-between state to review.
 *
 * WHY IT READS THROUGH THE DRAFT. `useEditableSrc`/`useEditableNum` return the value being
 * edited rather than the one the server sent, so dragging the crop moves the picture WHILE it
 * is dragged. Reading the server copy would mean the control appeared to do nothing until
 * Save, which the note on useEditableNum names as worse than having no control.
 */
export function PageBanner({ head, pathPrefix, children }: {
  head: PageHead
  /** The content key this page's head lives under — "featuresPage", "howPage". */
  pathPrefix: string
  /** Anything that should stand ON the banner. Ignored by the plate fallback. */
  children?: React.ReactNode
}) {
  const imgPath = `${pathPrefix}.heroImage`
  const src = useEditableSrc(imgPath, head.heroImage)
  const scale = useEditableNum(`${pathPrefix}.heroImageScale`, head.heroImageScale)
  const fx = useEditableNum(`${pathPrefix}.heroImageFocusX`, head.heroImageFocusX)
  const fy = useEditableNum(`${pathPrefix}.heroImageFocusY`, head.heroImageFocusY)

  /* NO PICTURE — the plate, exactly as this page has always drawn it. It is NOT wrapped in an
     EditableImage: an upload control floating over a plate that has no picture in it would be
     a control for something that is not there. The picture is set from Settings › Site content
     until the page has one, and from then on it is replaceable in place. */
  if (!src) return <PlateHero title={head.title} accent={head.accent} sub={head.sub} path={pathPrefix}>{children}</PlateHero>

  return (
    <EditableImage path={imgPath} transform="bleed">
      <MediaHero media={src} alt={head.heroImageAlt} focusX={fx} focusY={fy} scale={scale} tone="ink">
        {children}
      </MediaHero>
    </EditableImage>
  )
}
