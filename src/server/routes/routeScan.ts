export type RouteShape = "literal" | "regex";

export type Route = {
  method: string;
  pattern: string;
  line: number;
  shape: RouteShape;
  source: string;
};

export type RouteSource = {
  file: string;
  text: string;
};

const METHOD_LINE = /request\.method === "([A-Z]+)"/;
const LITERAL_LINE = /path === "(\/api\/[^"]+)"/;
const REGEX_LINE = /const \w+ = \/(.*)\/\.exec\(path\)/;

export function extractRoutes(sources: RouteSource[]): Route[] {
  const routes: Route[] = [];
  for (const { file, text } of sources) {
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const literal = LITERAL_LINE.exec(line);
      const method = METHOD_LINE.exec(line);
      const regexRoute = REGEX_LINE.exec(line);

      if (literal && method) {
        routes.push({ method: method[1], pattern: literal[1], line: index + 1, shape: "literal", source: file });
      } else if (regexRoute) {
        routes.push({ method: "*", pattern: `/${regexRoute[1]}/`, line: index + 1, shape: "regex", source: file });
      }
    }
  }
  return routes;
}

export function dedupeRoutes(routes: Route[]): Route[] {
  return routes.filter((route, index) =>
    routes.findIndex((other) => other.method === route.method && other.pattern === route.pattern) === index);
}
