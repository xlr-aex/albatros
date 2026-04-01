"use strict";
const electron = require("electron");
const api = {
  // ── Feeds ────────────────────────────────────────────────────────────────
  feeds: {
    list: () => electron.ipcRenderer.invoke("feeds:list"),
    add: (url, groupId) => electron.ipcRenderer.invoke("feeds:add", url, groupId),
    update: (id, patch) => electron.ipcRenderer.invoke("feeds:update", id, patch),
    delete: (id) => electron.ipcRenderer.invoke("feeds:delete", id)
  },
  // ── Groups ───────────────────────────────────────────────────────────────
  groups: {
    list: () => electron.ipcRenderer.invoke("groups:list"),
    create: (name) => electron.ipcRenderer.invoke("groups:create", name),
    update: (id, patch) => electron.ipcRenderer.invoke("groups:update", id, patch),
    delete: (id) => electron.ipcRenderer.invoke("groups:delete", id)
  },
  // ── Articles ─────────────────────────────────────────────────────────────
  articles: {
    list: (params) => electron.ipcRenderer.invoke("articles:list", params),
    get: (id) => electron.ipcRenderer.invoke("articles:get", id),
    totalUnread: () => electron.ipcRenderer.invoke("articles:total-unread"),
    mark: (id, action, value) => electron.ipcRenderer.invoke("articles:mark", id, action, value),
    markAllRead: (feedId) => electron.ipcRenderer.invoke("articles:mark-all-read", feedId),
    getGithubLinks: () => electron.ipcRenderer.invoke("articles:get-github-links"),
    getRedditComments: (url) => electron.ipcRenderer.invoke("articles:get-reddit-comments", url)
  },
  // ── Search ───────────────────────────────────────────────────────────────
  search: {
    query: (q, limit) => electron.ipcRenderer.invoke("search:query", q, limit)
  },
  // ── Sync ─────────────────────────────────────────────────────────────────
  sync: {
    refreshAll: () => electron.ipcRenderer.invoke("sync:refresh-all"),
    refreshFeed: (feedId) => electron.ipcRenderer.invoke("sync:refresh-feed", feedId),
    /**
     * Subscribes to real-time sync status updates pushed from the main process.
     * Returns an unsubscribe function — call it in useEffect cleanup.
     */
    onUpdate: (cb) => {
      const handler = (_event, payload) => cb(payload);
      electron.ipcRenderer.on("sync:update", handler);
      return () => electron.ipcRenderer.off("sync:update", handler);
    }
  },
  // ── Settings ─────────────────────────────────────────────────────────────
  settings: {
    getAll: () => electron.ipcRenderer.invoke("settings:get-all"),
    get: (key) => electron.ipcRenderer.invoke("settings:get", key),
    set: (key, value) => electron.ipcRenderer.invoke("settings:set", key, value)
  },
  // ── OPML ─────────────────────────────────────────────────────────────────
  opml: {
    import: () => electron.ipcRenderer.invoke("opml:import"),
    export: () => electron.ipcRenderer.invoke("opml:export")
  }
};
electron.contextBridge.exposeInMainWorld("api", api);
