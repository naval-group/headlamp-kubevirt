/**
 * Offline icon bundle for airgapped environments.
 *
 * Registers all MDI icons used across the plugin so that @iconify/react
 * never needs to fetch from the Iconify CDN at runtime.
 *
 * The icon data in mdi-icons.json was extracted from @iconify/json at build time.
 * To add new icons: add them to the extraction script, regenerate the JSON,
 * and update this import.
 *
 * Import this module once at the plugin entry point (index.tsx).
 */
import { addCollection } from '@iconify/react';
import mdiIcons from './mdi-icons.json';
import simpleIcons from './simple-icons.json';

addCollection(mdiIcons);
addCollection(simpleIcons);
