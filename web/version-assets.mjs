// Handles HTML attributes and dynamically loaded same-origin script paths.
export function versionAssets(html, versions) {
  return html.replace(/(["'])(\/[A-Za-z0-9_.-]+\.(?:js|css))\1/g,
    (match, quote, path) => versions[path] ? quote + versions[path] + quote : match);
}
