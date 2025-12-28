/**
 * SpriteAtlas - Manages loading and caching of sprite images
 */
export class SpriteAtlas {
  private cache: Map<string, HTMLImageElement> = new Map();
  private loading: Map<string, Promise<HTMLImageElement>> = new Map();
  private errorCache: Set<string> = new Set();

  /**
   * Get a sprite image, loading it if necessary
   */
  async get(url: string): Promise<HTMLImageElement | null> {
    // Check error cache first
    if (this.errorCache.has(url)) {
      return null;
    }

    // Check loaded cache
    const cached = this.cache.get(url);
    if (cached) {
      return cached;
    }

    // Check if already loading
    const loadingPromise = this.loading.get(url);
    if (loadingPromise) {
      try {
        return await loadingPromise;
      } catch {
        return null;
      }
    }

    // Start loading
    const promise = this.loadImage(url);
    this.loading.set(url, promise);

    try {
      const img = await promise;
      this.cache.set(url, img);
      this.loading.delete(url);
      return img;
    } catch {
      this.errorCache.add(url);
      this.loading.delete(url);
      return null;
    }
  }

  /**
   * Get a sprite image synchronously (returns null if not loaded)
   */
  getSync(url: string): HTMLImageElement | null {
    return this.cache.get(url) ?? null;
  }

  /**
   * Preload a sprite image
   */
  preload(url: string): void {
    if (!this.cache.has(url) && !this.loading.has(url) && !this.errorCache.has(url)) {
      this.get(url).catch(() => {});
    }
  }

  /**
   * Preload multiple sprites
   */
  preloadMultiple(urls: string[]): void {
    for (const url of urls) {
      this.preload(url);
    }
  }

  /**
   * Load an image
   */
  private loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load: ${url}`));
      img.src = url;
    });
  }

  /**
   * Clear all cached images
   */
  clear(): void {
    this.cache.clear();
    this.loading.clear();
    this.errorCache.clear();
  }

  /**
   * Get cache stats
   */
  getStats(): { loaded: number; loading: number; errors: number } {
    return {
      loaded: this.cache.size,
      loading: this.loading.size,
      errors: this.errorCache.size,
    };
  }
}

// Global singleton
export const spriteAtlas = new SpriteAtlas();
