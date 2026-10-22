import { posix } from 'node:path';

/**
 * The static ES module graph reachable from `entries` (posix paths; `base` is a prefix such as a vendored directory,
 * or '' for the repository root). `read(path)` returns the module's text or null. Bare specifiers, dynamic loading
 * and imports that leave `base` are refused. Used to pin the vendored SDK and to list the Activity client's files.
 */
export function moduleClosure(read, base, entries) {
  const seen = new Set(), queue = entries.map(entry => posix.join(base, entry));
  while (queue.length) {
    const path = queue.pop();
    if (seen.has(path)) continue;
    const text = read(path);
    if (text === null) throw new Error(`Missing module: ${path}`);
    seen.add(path);
    if (/\bimport\s*\(|\brequire\s*\(|\beval\s*\(|new\s+Function\s*\(/.test(text)) throw new Error(`Dynamic loading in ${path}`);
    for (const match of text.matchAll(/(?:import|export)\s[^'"]*?from\s*'([^']+)'|import\s*'([^']+)'/g)) {
      const specifier = match[1] ?? match[2];
      if (!specifier.startsWith('.')) throw new Error(`Bare import ${specifier} in ${path}`);
      const target = posix.normalize(posix.join(posix.dirname(path), specifier));
      if (target.startsWith('../') || !target.startsWith(base)) throw new Error(`Import leaves ${base || 'the repository'}: ${path}`);
      queue.push(target);
    }
  }
  return [...seen].sort();
}
