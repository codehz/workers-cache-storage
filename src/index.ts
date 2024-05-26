type Converters<K extends {}, V> = {
  key(key: K): RequestInfo;
  /** hack for response patch */
  patch?(value: Awaited<V>, ttl: number): Awaited<V>;
  value(value: V, ttl: number): Response;
  decode(value: Response): V | Promise<V>;
};

export type WrapOptions = {
  ttl?: number;
  waitUntil?: (promise: Promise<any>) => void;
};

export class WorkersCacheStorage<K extends {}, V> {
  #name: string;
  #cache?: Cache;
  #converters: Converters<K, V>;
  constructor(
    name: string,
    converters: Converters<K, V>,
    public defaultTtl = 365 * 24 * 60 * 60
  ) {
    this.#name = name;
    this.#converters = converters;
  }
  #ensureCache(): Promise<Cache> | Cache {
    if (!this.#cache) {
      return caches.open(this.#name).then((cache) => (this.#cache = cache));
    }
    return this.#cache;
  }

  async put(key: K, value: V, ttl = this.defaultTtl): Promise<void> {
    const cache = await this.#ensureCache();
    await cache.put(
      this.#converters.key(key),
      this.#converters.value(value, ttl)
    );
  }

  async get(key: K): Promise<V | undefined> {
    const cache = await this.#ensureCache();
    const request = this.#converters.key(key);
    const response = await cache.match(request);
    return response && (await this.#converters.decode(response));
  }

  async delete(key: K): Promise<boolean> {
    const cache = await this.#ensureCache();
    const request = this.#converters.key(key);
    return cache.delete(request);
  }

  async wrap<R extends V = V>(
    key: K,
    getValue: () => Promise<R>,
    { ttl = this.defaultTtl, waitUntil }: WrapOptions = {}
  ): Promise<R> {
    const cache = await this.#ensureCache();
    const request = this.#converters.key(key);
    const response = await cache.match(request);
    if (response) {
      return (await this.#converters.decode(response)) as R;
    } else {
      let value = await getValue();
      if (this.#converters.patch)
        value = this.#converters.patch(value, ttl) as any;
      const response = this.#converters.value(value, ttl);
      if (response.ok && response.status === 200)
        waitUntil
          ? waitUntil(cache.put(request, response))
          : await cache.put(request, response);
      return value;
    }
  }

  define<P extends any[] = any[], R extends V = V>(
    getKey: (...params: P) => K,
    getValue: (...params: P) => Promise<R>,
    options?: WrapOptions
  ): { (...params: P): Promise<R>; reset(...params: P): Promise<boolean> } {
    return Object.assign(
      (...params: P) => {
        return this.wrap(getKey(...params), () => getValue(...params), options);
      },
      {
        reset: (...params: P) => this.delete(getKey(...params)),
      }
    );
  }

  static forHttpResponse(
    name: string,
    overrides: ((ttl: number) => string) | boolean = false
  ) {
    return new WorkersCacheStorage<Request, Response>(name, {
      key(key) {
        return key;
      },
      patch: overrides
        ? (value, ttl) => {
            const cache =
              typeof overrides === "function"
                ? overrides(ttl)
                : `max-age=${ttl}`;
            return new Response(value.body, {
              status: value.status,
              statusText: value.statusText,
              headers: { ...value.headers, "Cache-Control": cache },
            });
          }
        : undefined,
      value(value) {
        return value.clone();
      },
      decode(value) {
        return value;
      },
    });
  }

  static json<V extends {}>(name: string): WorkersCacheStorage<string, V>;
  static json<K extends {}, V extends {}>(
    name: string,
    key: (key: K) => RequestInfo
  ): WorkersCacheStorage<K, V>;
  static json<K extends {}, V extends {}>(
    name: string,
    key: (key: K) => RequestInfo = (key: any) =>
      `http://dummy?${encodeURIComponent(key)}`
  ) {
    return new WorkersCacheStorage<K, V>(name, {
      key,
      value(value, ttl) {
        return new Response(JSON.stringify(value), {
          headers: { "Cache-Control": `max-age=${ttl}` },
        });
      },
      decode(value: Response) {
        return value.json();
      },
    });
  }

  static typed<T extends Record<string, unknown>>(
    name: string
  ): {
    defaultTtl: number;
    put<K extends keyof T>(key: K, value: T[K], ttl?: number): Promise<void>;
    get<K extends keyof T>(key: K): Promise<T[K] | undefined>;
    delete(key: keyof T): Promise<boolean>;
    wrap<K extends keyof T>(
      key: K,
      waitUntil: (promise: Promise<any>) => void,
      getValue: () => Promise<T[K]>,
      ttl?: number
    ): Promise<T[K]>;
  } {
    return WorkersCacheStorage.json(name) as any;
  }

  static text(name: string): WorkersCacheStorage<string, string>;
  static text<K extends {}>(
    name: string,
    key: (key: K) => RequestInfo
  ): WorkersCacheStorage<K, string>;
  static text<K extends {}>(
    name: string,
    key: (key: K) => RequestInfo = (key: any) =>
      `http://dummy?${encodeURIComponent(key)}`
  ) {
    return new WorkersCacheStorage<K, string>(name, {
      key,
      value(value, ttl) {
        return new Response(value, {
          headers: { "Cache-Control": `max-age=${ttl}` },
        });
      },
      decode(value: Response) {
        return value.text();
      },
    });
  }
  static void(name: string): WorkersCacheStorage<string, void>;
  static void<K extends {}>(
    name: string,
    key: (key: K) => RequestInfo
  ): WorkersCacheStorage<K, void>;
  static void<K extends {}>(
    name: string,
    key: (key: K) => RequestInfo = (key: any) =>
      `http://dummy?${encodeURIComponent(key)}`
  ): WorkersCacheStorage<K, void> {
    return new WorkersCacheStorage<K, void>(name, {
      decode(_) {
        return;
      },
      key,
      value(_, ttl) {
        return new Response(null, {
          headers: { "Cache-Control": `max-age=${ttl}` },
        });
      },
    });
  }
}

/** @deprecated: use WorkersCacheStorage */
export const CacheStorage = WorkersCacheStorage;
