import { provideHttpClient, withFetch } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideLucideConfig } from '@lucide/angular';
import { routes } from './app.routes';
import { tokens } from './tokens';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    // The REST API, same-origin (proxied to the API in development, see proxy.conf.json).
    provideHttpClient(withFetch()),
    // Lucide at the token stroke (2) with round caps and joins, its own default.
    provideLucideConfig({ strokeWidth: tokens.icon.stroke }),
  ],
};
