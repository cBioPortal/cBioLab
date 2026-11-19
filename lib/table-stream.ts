// A table streamed whole for a download (app/api/table): its header, then its rows a page at a time in one order
// across every cohort and study. No database here: the caller passes how a page is read.
import { TABLE_CHUNK, pagedTable } from "./views/rows.ts";
import type { TableRows, ViewResult } from "./types.ts";

/**
 * A table's rows streamed whole, a page of TABLE_CHUNK at a time in one order across every cohort and
 * study: the header, each page's lines, and on any failure (the header's included) a last line saying
 * the file was cut short. `have`, the rows the run that sized the table already read from its start, are
 * written first and not read again: a table of up to one page runs once.
 */
export function pageStream(total: number, page: (offset: number) => Promise<{ views: ViewResult[] }>, table: string | undefined,
  write: { head: () => string; rows: (p: TableRows<unknown>) => string; cut: (why: string) => string }, have?: TableRows<unknown>, chunk: number = TABLE_CHUNK): ReadableStream<Uint8Array> {
  // rows already read from the table's start (the run that sized it): written first, and the pages go on after them
  const from = have && have.offset === 0 ? Math.min(have.rows.length, total) : 0;
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(enc.encode(write.head()));
        if (from) controller.enqueue(enc.encode(write.rows(have!)));
        for (let offset = from; offset < total; offset += chunk) {
          const r = await page(offset);
          const p = pagedTable(r.views[0], table);
          if (!p) throw new Error(r.views[0].error || "the page at row " + offset + " returned nothing");
          controller.enqueue(enc.encode(write.rows(p)));
        }
      } catch (e) {
        controller.enqueue(enc.encode(write.cut(String((e as Error)?.message || e))));
      }
      controller.close();
    }
  });
}
