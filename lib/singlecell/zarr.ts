// Reading a Cell Explorer dataset's cell metadata (AnnData `obs`) from its zarr store, one column at
// a time, in the browser or in node. Only obs is read — the expression matrix is never touched.
//
// Browser-safe: the review page (app/singlecell/) reads columns directly from the public bucket,
// which allows any origin; the CLI (scripts/gen-singlecell-summary.ts) reads the same way.
import * as zarr from "zarrita";

/** a categorical column: the label of each cell (null where the code is -1, no value) */
export interface LabelColumn { kind: "label"; values: (string | null)[] }
/** a numeric column: NaN where a cell has no value */
export interface NumberColumn { kind: "number"; values: Float64Array }
export type ObsColumn = LabelColumn | NumberColumn;

export interface ObsStore {
  url: string;
  /** the obs column names in the order AnnData wrote them */
  columns: string[];
  read(name: string): Promise<ObsColumn>;
}

/** zarr v3 first (every Cell Explorer dataset so far): asking for it directly spares a v2 probe per node, each a 404 */
function openNode(loc: zarr.Location<zarr.FetchStore>): Promise<zarr.Array<zarr.DataType, zarr.FetchStore> | zarr.Group<zarr.FetchStore>>;
function openNode(loc: zarr.Location<zarr.FetchStore>, kind: "array"): Promise<zarr.Array<zarr.DataType, zarr.FetchStore>>;
function openNode(loc: zarr.Location<zarr.FetchStore>, kind: "group"): Promise<zarr.Group<zarr.FetchStore>>;
function openNode(loc: zarr.Location<zarr.FetchStore>, kind?: "array" | "group") {
  const opts = kind ? { kind } : {};
  return (zarr.open.v3(loc, opts as { kind: "array" }) as Promise<unknown>).catch(() => zarr.open(loc, opts as { kind: "array" }));
}

export async function openObs(url: string): Promise<ObsStore> {
  const root = zarr.root(new zarr.FetchStore(url.replace(/\/+$/, "")));
  const obs = await openNode(root.resolve("obs"), "group");
  const order = (obs.attrs as { "column-order"?: string[] })["column-order"] || [];
  const cache = new Map<string, Promise<ObsColumn>>();
  const read = (name: string): Promise<ObsColumn> => {
    if (!order.includes(name)) return Promise.reject(new Error("this dataset has no column " + JSON.stringify(name)));
    const hit = cache.get(name);
    if (hit) return hit;
    const p = (async (): Promise<ObsColumn> => {
      const node = await openNode(root.resolve("obs/" + name));
      if (node instanceof zarr.Group) {
        const [codes, cats] = await Promise.all([
          openNode(root.resolve("obs/" + name + "/codes"), "array").then((a) => zarr.get(a)),
          openNode(root.resolve("obs/" + name + "/categories"), "array").then((a) => zarr.get(a)),
        ]);
        const labels = Array.from(cats.data as ArrayLike<unknown>, (x) => String(x));
        const c = codes.data as ArrayLike<number>;
        const values = new Array<string | null>(c.length);
        for (let i = 0; i < c.length; i++) values[i] = c[i] >= 0 ? labels[c[i]] : null;
        return { kind: "label", values };
      }
      const a = await zarr.get(node as zarr.Array<zarr.DataType, zarr.FetchStore>);
      const d = a.data as ArrayLike<unknown>;
      if (typeof d[0] === "string" || (d.length && typeof d[0] !== "number" && typeof d[0] !== "bigint" && typeof d[0] !== "boolean"))
        return { kind: "label", values: Array.from(d, (x) => (x == null ? null : String(x))) };
      const values = new Float64Array(d.length);
      for (let i = 0; i < d.length; i++) values[i] = Number(d[i] as number);
      return { kind: "number", values };
    })();
    cache.set(name, p);
    p.catch(() => cache.delete(name));
    return p;
  };
  return { url, columns: order, read };
}
