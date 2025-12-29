/// <reference types="vite/client" />

// R3F JSX element types - extend JSX.IntrinsicElements
import type { ThreeElements } from '@react-three/fiber';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}
