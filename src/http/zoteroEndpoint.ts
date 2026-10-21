// Adapts an HttpHandler to the endpoint class shape Zotero.Server.Endpoints expects.
import { EndpointDef, HttpHandler, HttpRequest } from "../registry/types";

/** What Zotero's server does with the return value of init(req): [status, headers, body, options]. */
export type ZoteroResponseTuple = [number, Record<string, string | number>, string, Record<string, unknown>?];

export function toZoteroEndpoint(def: EndpointDef, handler: HttpHandler) {
  return class SafeMcpEndpoint {
    supportedMethods = def.methods;
    supportedDataTypes = def.dataTypes;
    // Exactly one parameter: Zotero selects the request-object form by init.length.
    async init(req: HttpRequest): Promise<ZoteroResponseTuple> {
      const res = await handler(req);
      const tuple: ZoteroResponseTuple = [res.status, res.headers ?? {}, res.body ?? ""];
      if (res.options) tuple.push(res.options);
      return tuple;
    }
  };
}
