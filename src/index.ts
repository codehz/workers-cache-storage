type Converters<K extends {}, V extends {}> = {
  key(key: K): RequestInfo;
  /** hack for response patch */
  patch?(value: Awaited<V>, ttl: number): Awaited<V>;
  value(value: V, ttl: number): Response;
  decode(value: Response): V | Promise<V>;
};

export class WorkersCacheStorage<K extends {}, V extends {}> {
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

  async wrap<R extends V = V>(
    key: K,
    waitUntil: (promise: Promise<any>) => void,
    getValue: () => Promise<R>,
    ttl = this.defaultTtl
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
        waitUntil(cache.put(request, response));
      return value;
    }
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
}

/** @deprecated: use WorkersCacheStorage */
export const CacheStorage = WorkersCacheStorage;
