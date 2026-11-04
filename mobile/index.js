/**
 * Entry point. Registers the root component with Expo, which sets up the
 * runtime the same way in Expo Go and in native builds.
 */

import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
