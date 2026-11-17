// A figure's Download menu, the portal's DownloadControls: the figure as drawn saved as SVG, PNG or
// PDF under the portal's file name, with the light theme's literal colours.
import { useState } from "react";
import { CloudDownload } from "lucide-react";
import { savePdf, savePng, standaloneSvg } from "./chart-files.ts";
import { saveText } from "../../lib/study-view-download.ts";
import { Button } from "../_ui/button";
import { TB } from "../_ui/toolbar.ts";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../_ui/dropdown-menu";

export type ImageFormat = "svg" | "png" | "pdf";

/**
 * The menu: one entry per format, in the order given (the portal's order for the figure). `svg`
 * draws the figure for saving, in the light theme; null saves nothing. `extra` entries follow the
 * formats (the portal's additionalRightButtons, e.g. the timeline's "Data (ZIP)").
 */
export function ImageDownload({ name, formats, svg, label, tip, extra }: {
  name: string; formats: ImageFormat[]; svg: () => string | null; label: string; tip: string;
  extra?: { label: string; save: () => void }[];
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const save = (fmt: ImageFormat) => {
    setFailed(null);
    const raw = svg();
    if (!raw) return;
    const s = standaloneSvg(raw), file = name + "." + fmt;
    if (fmt === "svg") saveText(file, s);
    else (fmt === "png" ? savePng(file, s) : savePdf(file, s)).catch((e) => setFailed("Could not make the " + fmt.toUpperCase() + ": " + String((e as Error)?.message || e)));
  };
  return (
    <>
      {failed && <span className="meta" role="alert">{failed}</span>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" className={TB} aria-label={label} data-tip={tip}>
            <CloudDownload />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {formats.map((f) => <DropdownMenuItem key={f} onSelect={() => save(f)}>{f.toUpperCase()}</DropdownMenuItem>)}
          {(extra || []).map((x) => <DropdownMenuItem key={x.label} onSelect={() => { setFailed(null); try { x.save(); } catch (e) { setFailed("Could not make " + x.label + ": " + String((e as Error)?.message || e)); } }}>{x.label}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
