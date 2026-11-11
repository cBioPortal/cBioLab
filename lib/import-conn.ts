// The connection local mode's import page hands @cbiolab/importer: the app's own primary database,
// with every statement sent through lib/ch.ts's `chWrite` (the app's one way to ClickHouse, with
// its checks) rather than the package's own client. The command-line import uses the package's.
import type { Conn } from "@cbiolab/clickhouse";
import { chWrite, PRIMARY } from "./ch.ts";

export function importConn(): Conn {
  // no address or credentials of its own: `send` is the only way its statements leave
  return { id: PRIMARY.id, url: "", user: "", password: "", db: PRIMARY.db, label: PRIMARY.label,
    send: (sql, body, settings) => chWrite(sql, PRIMARY, body, settings) };
}
