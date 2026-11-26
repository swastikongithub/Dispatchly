import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Observable } from 'rxjs';
import { ApiClient, problemOf, type Api } from './api-client';

describe('ApiClient', () => {
  let api: ApiClient;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ApiClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('fills in path parameters, encoded', () => {
    let order: Api['OrderDetails'] | undefined;
    api.get('/api/v1/orders/{code}', { path: { code: 'DL 4817/x' } }).subscribe((o) => (order = o));

    const request = http.expectOne('/api/v1/orders/DL%204817%2Fx');
    expect(request.request.method).toBe('GET');
    request.flush({ code: 'DL-4817' });
    expect(order?.code).toBe('DL-4817');
  });

  it('sends the query, leaving out what is not set', () => {
    api.get('/api/v1/orders', { query: { status: 'Searching', late: undefined } }).subscribe();
    api.get('/api/v1/orders').subscribe();

    const [filtered, all] = http.match((r) => r.url === '/api/v1/orders');
    expect(filtered.request.urlWithParams).toBe('/api/v1/orders?status=Searching');
    expect(all.request.urlWithParams).toBe('/api/v1/orders');
    filtered.flush([]);
    all.flush([]);
  });

  it('sends the body as JSON with the right method', () => {
    api.put('/api/v1/rider/status', { body: { online: true } }).subscribe();
    api.post('/api/v1/orders/{code}/reassign', { path: { code: 'DL-4810' } }).subscribe();

    const status = http.expectOne('/api/v1/rider/status');
    expect(status.request.method).toBe('PUT');
    expect(status.request.body).toEqual({ online: true });
    status.flush({});
    const reassign = http.expectOne('/api/v1/orders/DL-4810/reassign');
    expect(reassign.request.method).toBe('POST');
    expect(reassign.request.body).toBeNull();
    reassign.flush({});
  });

  it('types every call from the contract', () => {
    // Checked when the tests compile; never run.
    const calls = () => {
      const order: Observable<Api['OrderDetails']> = api.get('/api/v1/orders/{code}', {
        path: { code: 'DL-4817' },
      });
      const moved: Observable<void> = api.post('/api/v1/rider/location', {
        body: { lat: 28.6, lng: 77.2, bearing: 90 },
      });
      // @ts-expect-error The order code is required.
      api.get('/api/v1/orders/{code}');
      // @ts-expect-error There's no "Lost" status.
      api.get('/api/v1/orders', { query: { status: 'Lost' } });
      // @ts-expect-error Orders can't be PUT.
      api.put('/api/v1/orders', { body: {} });
      // @ts-expect-error `online` is a boolean.
      api.put('/api/v1/rider/status', { body: { online: 'yes' } });
      return [order, moved];
    };
    expect(calls).toBeTypeOf('function');
  });

  it('hands back the problem details of a failed call', () => {
    let error: unknown;
    api.post('/api/v1/rider/task/deliver', { body: { code: '0000' } }).subscribe({
      error: (e: unknown) => (error = e),
    });

    http
      .expectOne('/api/v1/rider/task/deliver')
      .flush(
        { status: 422, title: 'Wrong delivery code', code: 'wrong_delivery_code' },
        { status: 422, statusText: 'Unprocessable Entity' },
      );

    expect(problemOf(error)?.code).toBe('wrong_delivery_code');
    expect(problemOf(new HttpErrorResponse({ status: 0 }))).toBeNull();
    expect(problemOf(new Error('offline'))).toBeNull();
  });
});
