import { InjectionToken } from '@angular/core';
import { FirebaseOptions } from 'firebase/app';
export interface Runtime { firebase: FirebaseOptions | null; }
export const RUNTIME = new InjectionToken<Runtime>('The Gathering Table runtime');
