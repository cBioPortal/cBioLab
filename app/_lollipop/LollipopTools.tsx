"use client";
// The portal's two buttons at the lollipop's top right: "Legend" (shows or hides the colour codes
// above the plot) and the download menu (the figure as SVG or PNG). The figure saved is the one on
// screen: the same draw() at the same width, with the view's hidden cells and selected codons.
import React from "react";
import { CloudDownload, Eye, EyeOff } from "lucide-react";
import { Button } from "../_ui/button";
import { TB } from "../_ui/toolbar.ts";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../_ui/dropdown-menu";

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** the figure as a file: its own size, not the page's 100% width */
function sized(svg: string): string {
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  return vb ? svg.replace(' width="100%"', ' width="' + vb[1] + '" height="' + vb[2] + '"') : svg;
}

/** the SVG text as a PNG at twice its size, on the page's background */
async function pngOf(svg: string): Promise<Blob> {
  const img = new Image();
  const src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("the figure could not be drawn as an image")); img.src = src; });
    const scale = 2, cv = document.createElement("canvas");
    cv.width = Math.ceil(img.naturalWidth * scale); cv.height = Math.ceil(img.naturalHeight * scale);
    const g = cv.getContext("2d")!;
    g.scale(scale, scale); g.drawImage(img, 0, 0);
    return await new Promise((res, rej) => cv.toBlob((b) => b ? res(b) : rej(new Error("the PNG could not be made")), "image/png"));
  } finally { URL.revokeObjectURL(src); }
}

export function LollipopTools({ legend, onLegend, svg, filename }: {
  legend: boolean; onLegend: (next: boolean) => void;
  /** the figure as on screen, drawn when a download is chosen with the light theme's literal colours (svg-kit palette) */
  svg: () => string | null; filename: string;
}) {
  const download = async (fmt: "svg" | "png") => {
    const drawn = svg();
    if (!drawn) return;
    const s = sized(drawn);
    save(fmt === "svg" ? new Blob([s], { type: "image/svg+xml" }) : await pngOf(s), filename + "." + fmt);
  };
  return (
    <div className="flex items-center gap-1.5">
      <Button type="button" variant="outline" size="sm" className={TB} aria-pressed={legend} onClick={() => onLegend(!legend)}
        data-tip={(legend ? "hide" : "show") + " what the circles' colours mean"}>Legend {legend ? <EyeOff /> : <Eye />}</Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" className={TB} aria-label="download the mutation diagram" data-tip="download the mutation diagram as drawn">
            <CloudDownload />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void download("svg")}>SVG</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void download("png")}>PNG</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
