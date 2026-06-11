import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { MpidRadar, loadDataset } from "./core.js";

const BUNDLED_FILE = fileURLToPath(new URL("../data/latest.json", import.meta.url));
const CACHE_DIR = fileURLToPath(new URL("../data/cache/", import.meta.url));
const CACHE_FILE = join(CACHE_DIR, "latest.json");
const ETAG_FILE = join(CACHE_DIR, "latest.etag");

const DEFAULT_URL = "https://raw.githubusercontent.com/adriansprk/mpid-radar/main/data/latest.json";
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // re-check every 6 hours while the process is alive

function envFlag(value) {
  return value === "1" || value === "true";
}

/**
 * Holds the active MpidRadar instance and keeps it current.
 *
 * Loads bundled (or cached) data immediately so startup is instant and works
 * offline, then refreshes from the published dataset in the background and
 * hot-swaps the instance when the content changes. Every network path is
 * fault-tolerant: failures are logged to stderr and the last-good dataset
 * keeps serving.
 *
 * Env overrides: MPID_RADAR_OFFLINE=1 disables all network access;
 * MPID_RADAR_DATA_URL points at a mirror.
 */
export class DatasetHolder {
  constructor({ url, offline, ttlMs, log } = {}) {
    this.url = url ?? process.env.MPID_RADAR_DATA_URL ?? DEFAULT_URL;
    this.offline = offline ?? envFlag(process.env.MPID_RADAR_OFFLINE);
    this.ttlMs = ttlMs ?? DEFAULT_TTL_MS;
    this.log = log ?? ((message) => process.stderr.write(`[mpid-radar] ${message}\n`));
    this.etag = null;
    this.timer = null;
    this.radar = this.loadInitial();
  }

  get() {
    return this.radar;
  }

  loadInitial() {
    // Prefer the cache (most recently refreshed) over the bundled snapshot.
    for (const source of [CACHE_FILE, BUNDLED_FILE]) {
      if (!existsSync(source)) continue;
      try {
        const radar = loadDataset(source);
        if (source === CACHE_FILE) this.etag = this.readEtag();
        this.log(`loaded dataset ${radar.meta.dataset?.version || "?"} from ${source}`);
        return radar;
      } catch (error) {
        this.log(`failed to load ${source}: ${error.message}`);
      }
    }
    // Last resort: an empty dataset so the server still starts and answers.
    this.log("no dataset available; serving empty dataset");
    return new MpidRadar({});
  }

  readEtag() {
    try {
      return existsSync(ETAG_FILE) ? readFileSync(ETAG_FILE, "utf8").trim() : null;
    } catch {
      return null;
    }
  }

  /** Fetch the published dataset and hot-swap if the content changed. */
  async refresh() {
    if (this.offline) return false;
    try {
      const headers = this.etag ? { "If-None-Match": this.etag } : {};
      const response = await fetch(this.url, { headers });
      if (response.status === 304) {
        this.log("dataset unchanged (304)");
        return false;
      }
      if (!response.ok) {
        this.log(`refresh failed: HTTP ${response.status}`);
        return false;
      }
      const text = await response.text();
      const data = JSON.parse(text);
      const etag = response.headers.get("etag");
      const newHash = data.meta?.dataset?.content_hash;
      const currentHash = this.radar.meta.dataset?.content_hash;
      if (newHash && currentHash && newHash === currentHash) {
        // Same data; remember the etag so future polls short-circuit to 304.
        if (etag) this.persist(null, etag);
        this.etag = etag ?? this.etag;
        this.log("dataset unchanged (same content_hash)");
        return false;
      }
      this.radar = new MpidRadar(data, CACHE_FILE);
      this.etag = etag;
      this.persist(text, etag);
      this.log(`refreshed to dataset ${data.meta?.dataset?.version || "?"}`);
      return true;
    } catch (error) {
      this.log(`refresh error: ${error.message}`);
      return false;
    }
  }

  persist(text, etag) {
    try {
      mkdirSync(CACHE_DIR, { recursive: true });
      if (text !== null) writeFileSync(CACHE_FILE, text);
      if (etag) writeFileSync(ETAG_FILE, etag);
    } catch (error) {
      this.log(`cache write failed: ${error.message}`);
    }
  }

  /** Kick off an immediate refresh and schedule periodic re-checks. */
  start() {
    this.refresh();
    if (this.ttlMs > 0 && !this.offline) {
      this.timer = setInterval(() => this.refresh(), this.ttlMs);
      this.timer.unref?.();
    }
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
