export function commFromProcStat(stat: string): string | null {
  const open = stat.indexOf("(");
  const close = stat.lastIndexOf(")");
  if (open < 0 || close <= open + 1) return null;
  return stat.slice(open + 1, close);
}

export function rssPagesFromProcStat(stat: string): number | null {
  const close = stat.lastIndexOf(")");
  if (close < 0) return null;
  const fields = stat.slice(close + 2).trim().split(/\s+/);
  if (fields.length < 22) return null;
  const rss = Number(fields[21]);
  return Number.isFinite(rss) ? rss : null;
}

export function prettyNameFromOsRelease(text: string): string | null {
  const match = text.match(/^PRETTY_NAME="?([^"\n]*)"?\s*$/m);
  return match ? match[1]! : null;
}

export function sumRssForComm(entries: Array<{ comm: string | null; rssPages: number | null }>, prefix: string): number {
  return entries.reduce((sum, entry) => {
    if (!entry.comm || !entry.comm.startsWith(prefix) || entry.rssPages === null) return sum;
    return sum + entry.rssPages;
  }, 0);
}
