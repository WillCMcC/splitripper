/**
 * File resolver - handles searching for files dropped from iTunes/Music app
 */

import { api } from './api.js';

/**
 * Resolve iTunes/Music app files that don't have paths
 * When files are dragged from iTunes, they don't have a file system path,
 * so we need to search for them by name and size.
 *
 * @param {Array<{name: string, size: number, type: string}>} iTunesFiles - Files to resolve
 * @param {function} onStatusUpdate - Callback for status updates
 * @returns {Promise<{resolved: string[], resolvedCount: number}>}
 */
export async function resolveITunesFiles(iTunesFiles, onStatusUpdate) {
  const resolved = [];
  let resolvedCount = 0;

  if (onStatusUpdate) {
    onStatusUpdate(`Searching for ${iTunesFiles.length} file(s) from iTunes/Music app...`);
  }

  for (const iTunesFile of iTunesFiles) {
    try {
      console.log(`Searching for: ${iTunesFile.name} (size: ${iTunesFile.size})`);

      let resp;
      if (window.electronAPI && window.electronAPI.findFile) {
        // Use Electron's native file search
        const searchSize = iTunesFile.size > 0 ? iTunesFile.size : null;
        resp = await window.electronAPI.findFile(iTunesFile.name, searchSize);
      } else {
        // Fallback to backend API if not in Electron
        if (iTunesFile.size > 0) {
          resp = await api(
            `/api/find-file?name=${encodeURIComponent(iTunesFile.name)}&size=${iTunesFile.size}`
          );
        } else {
          console.log(`File has size 0, searching without size constraint...`);
          resp = await api(
            `/api/find-file?name=${encodeURIComponent(iTunesFile.name)}`
          );
        }
      }

      if (resp.files && resp.files.length > 0) {
        // Found the file! Use the first match
        const foundFile = resp.files[0];
        resolved.push(foundFile.path);
        resolvedCount++;
        console.log(`Found iTunes file: ${foundFile.path}`);
      } else {
        console.warn(`Could not find iTunes file: ${iTunesFile.name}`);
        console.log("Searched paths:", resp.searched_paths || "unknown");
        if (resp.debug) {
          console.log("Search debug info:", resp.debug);
        }
      }
    } catch (searchError) {
      console.error(`Error searching for ${iTunesFile.name}:`, searchError);
    }
  }

  // Return result with status message
  const totalCount = iTunesFiles.length;
  let statusMessage;
  if (resolvedCount === totalCount) {
    statusMessage = `Found all ${resolvedCount} iTunes files!`;
  } else if (resolvedCount > 0) {
    statusMessage = `Found ${resolvedCount} of ${totalCount} iTunes files`;
  } else {
    statusMessage = `Could not locate any of the ${totalCount} iTunes files on disk`;
  }

  if (onStatusUpdate) {
    onStatusUpdate(statusMessage);
  }

  return { resolved, resolvedCount, statusMessage };
}
