import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { components, paths } from './schema';

/**
 * The REST API's types, generated from `openapi.json` (`npm run api`), e.g. `Api['OrderDetails']`.
 * The OpenAPI document comes from the API itself; an integration test keeps the copy here current.
 */
export type Api = components['schemas'];

/** RFC 9457 problem details. `code` is what to switch on, e.g. `no_free_rider`. */
export type Problem = Api['ProblemDetails'];

type Method = 'get' | 'post' | 'put';

/** The API paths with an operation for `M`, e.g. `PathsFor<'post'>`. */
export type PathsFor<M extends Method> = {
  [P in keyof paths]: [NonNullable<paths[P][M]>] extends [never] ? never : P;
}[keyof paths];

type Operation<P extends keyof paths, M extends Method> = NonNullable<paths[P][M]>;

type PathOf<O> = O extends { parameters: { path: infer T } } ? { path: T } : unknown;
type QueryOf<O> = O extends { parameters: { query: infer T } }
  ? { query: T }
  : O extends { parameters: { query?: infer T } }
    ? [NonNullable<T>] extends [never]
      ? unknown
      : { query?: T }
    : unknown;
type BodyOf<O> = O extends { requestBody: { content: { 'application/json': infer T } } }
  ? { body: T }
  : unknown;

/** What a call takes: path parameters, query and body, each only where the operation has one. */
export type RequestOptions<O> = PathOf<O> & QueryOf<O> & BodyOf<O>;

/** What a call returns: the JSON of its 200 or 201 response, or nothing for a 204. */
export type ResultOf<O> = O extends { responses: infer R }
  ? {
      [S in keyof R]: S extends 200 | 201
        ? R[S] extends { content: { 'application/json': infer T } }
          ? T
          : never
        : S extends 204
          ? void
          : never;
    }[keyof R]
  : never;

/** Options can be left out when nothing in them is required. */
type Args<O> =
  object extends RequestOptions<O> ? [options?: RequestOptions<O>] : [options: RequestOptions<O>];

interface UntypedOptions {
  path?: Record<string, string | number>;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
}

/**
 * Typed calls to the REST API: `api.get('/api/v1/orders/{code}', { path: { code } })` returns an
 * `Observable<Api['OrderDetails']>`. Paths are same-origin (the dev server proxies /api).
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);

  get<P extends PathsFor<'get'>>(path: P, ...[options]: Args<Operation<P, 'get'>>) {
    return this.send<ResultOf<Operation<P, 'get'>>>('GET', path, options);
  }

  post<P extends PathsFor<'post'>>(path: P, ...[options]: Args<Operation<P, 'post'>>) {
    return this.send<ResultOf<Operation<P, 'post'>>>('POST', path, options);
  }

  put<P extends PathsFor<'put'>>(path: P, ...[options]: Args<Operation<P, 'put'>>) {
    return this.send<ResultOf<Operation<P, 'put'>>>('PUT', path, options);
  }

  private send<T>(method: string, template: string, options: unknown): Observable<T> {
    const { path, query, body } = (options ?? {}) as UntypedOptions;
    const url = template.replace(/\{(\w+)\}/g, (_, name: string) => {
      const value = path?.[name];
      if (value === undefined) {
        throw new Error(`Missing path parameter "${name}" for ${template}`);
      }
      return encodeURIComponent(value);
    });
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) {
        params = params.set(key, String(value));
      }
    }
    return this.http.request<T>(method, url, { body, params, responseType: 'json' });
  }
}

/** The problem details behind a failed call, or null when the failure wasn't the API's answer. */
export function problemOf(error: unknown): Problem | null {
  if (error instanceof HttpErrorResponse && typeof error.error === 'object' && error.error) {
    return error.error as Problem;
  }
  return null;
}
