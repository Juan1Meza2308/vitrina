import type { VitrinaApi } from '../preload/index.ts';

declare global {
  interface Window {
    vitrina: VitrinaApi;
  }
}

export {};
