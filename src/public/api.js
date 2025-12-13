/**
 * API helper functions and DOM selectors
 */

// DOM Selectors
export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// Helper function to get current folder from localStorage
export function getCurrentFolder() {
  return localStorage.getItem("ytdl_directory_path") || "";
}

/**
 * Fetch wrapper with JSON handling
 * @param {string} path - API endpoint path
 * @param {RequestInit} opts - Fetch options
 * @returns {Promise<any>} - Parsed JSON response
 */
export async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (data && data.error) msg = data.error;
    } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}
