"use client";
// The portal's two buttons at the lollipop's top right: "Legend" (shows or hides the colour codes
// above the plot) and the download menu (the figure as SVG, PNG and, on the Mutations tab, PDF:
// the shared ImageDownload). The figure saved is the one on screen: the same draw() at the same
// width, with the view's hidden cells and selected codons.
import React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "../_ui/button";
import { TB } from "../_ui/toolbar.ts";
import { ImageDownload, type ImageFormat } from "../lab/image-download.tsx";

export function LollipopTools({ legend, onLegend, svg, filename, formats = ["svg", "png"] }: {
  legend: boolean; onLegend: (next: boolean) => void;
  /** the figure as on screen, drawn when a download is chosen with the light theme's literal colours (svg-kit palette) */
  svg: () => string | null; filename: string;
  /** the download menu's formats, in its order */
  formats?: ImageFormat[];
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Button type="button" variant="outline" size="sm" className={TB} aria-pressed={legend} onClick={() => onLegend(!legend)}
        data-tip={(legend ? "hide" : "show") + " what the circles' colours mean"}>Legend {legend ? <EyeOff /> : <Eye />}</Button>
      <ImageDownload name={filename} formats={formats} svg={svg} label="download the mutation diagram" tip="download the mutation diagram as drawn" />
    </div>
  );
}
