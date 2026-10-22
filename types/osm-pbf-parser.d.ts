declare module "osm-pbf-parser" {
  import type { Transform } from "node:stream";

  export interface OsmItem {
    type: "node" | "way" | "relation";
    id: number;
    lat?: number;
    lon?: number;
    tags?: Record<string, string>;
    refs?: number[];
    members?: Array<{ type: "node" | "way" | "relation"; id: number; role?: string }>;
  }

  /** Streaming OSM PBF parser; emits arrays of items. */
  function parseOsm(options?: unknown): Transform;
  export = parseOsm;
}
