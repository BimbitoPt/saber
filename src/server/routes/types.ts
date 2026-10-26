export type RouteContext = {
  request: Request;
  url: URL;
  path: string;
  method: string;
};

export type RouteHandler = (ctx: RouteContext) => Promise<Response | null> | Response | null;
