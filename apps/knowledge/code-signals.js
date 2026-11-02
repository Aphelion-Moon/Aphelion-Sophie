/** Words of a message as code search and question routing read them: letters, digits and _ . / - (backticked text left out). */
export const messageWords = text => text.replace(/`[^`\n]*`/gu, ' ').split(/[^A-Za-z0-9_.\/-]+/u).filter(Boolean);

/** camelCase, snake_case, a code file name or a path. */
export const codeIdentifier = word => /[a-z][A-Z]|_[A-Za-z]|^[A-Z][a-z]+[A-Z]/u.test(word) ||
  /\.(?:cs|dm|dme|yml|yaml|ftl|js|ts|py|json|xml|toml|md)$/iu.test(word) || /[a-z]\/[a-z]/iu.test(word);

/** Quoted names, identifiers and file names in a message: what makes it look like it is about code. */
export function codeSignals(text) {
  return [...[...text.matchAll(/`([^`\n]{2,60})`/gu)].map(match => match[1].trim()), ...messageWords(text).filter(codeIdentifier)];
}
