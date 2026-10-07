import { provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, withHashLocation, withInMemoryScrolling } from '@angular/router';
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { provideAuth, getAuth } from '@angular/fire/auth';
import { provideFirestore, getFirestore } from '@angular/fire/firestore';
import { FirebaseOptions } from 'firebase/app';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { RUNTIME } from './app/core/runtime';

async function launch(): Promise<void> {
  let firebase: FirebaseOptions | null = null;
  const response = await fetch(new URL('firebase-config.json', document.baseURI), { cache: 'no-store' });
  if (response.ok) {
    const config: unknown = await response.json();
    if (config && typeof config === 'object' && 'mode' in config && config.mode === 'demo') {
      firebase = null;
    } else {
      if (!config || typeof config !== 'object' || !('apiKey' in config) || !('projectId' in config) || !('appId' in config) || !('authDomain' in config) || Object.values(config).some(value => typeof value !== 'string') || String(config.projectId).includes('YOUR_')) throw new Error('Firebase configuration is invalid. Check firebase-config.json.');
      firebase = config as FirebaseOptions;
    }
  } else if (response.status !== 404) {
    throw new Error('Firebase configuration could not be loaded. Reload to try again.');
  }
  await bootstrapApplication(AppComponent, {
    providers: [
      provideBrowserGlobalErrorListeners(), provideZonelessChangeDetection(),
      provideRouter(routes, withHashLocation(), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
      { provide: RUNTIME, useValue: { firebase } },
      ...(firebase ? [provideFirebaseApp(() => initializeApp(firebase!)), provideAuth(() => getAuth()), provideFirestore(() => getFirestore())] : []),
    ],
  });
}
launch().catch(error => {
  document.body.textContent = error instanceof Error ? error.message : 'The app could not start. Please reload.';
});
