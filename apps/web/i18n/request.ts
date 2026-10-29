/**
 * App-specific i18n request configuration.
 * Loads translation messages from the app's messages directory.
 *
 * Supports two loading strategies:
 * 1. Single file: messages/${locale}.json (all namespaces in one file)
 * 2. Multiple files: messages/${locale}/*.json (namespaces in separate files for lazy loading)
 *
 */
import { cacheLife } from 'next/cache';
import { locale as localeRootParam } from 'next/root-params';

import { getRequestConfig } from 'next-intl/server';

import { routing } from '@kit/i18n/routing';

// Define the namespaces to load
const namespaces = [
  'common',
  'auth',
  'account',
  'teams',
  'billing',
  'marketing',
  'campaigns',
  'prospects',
] as const;

const isDevelopment = process.env.NODE_ENV === 'development';

export default getRequestConfig(async ({ locale: localeOverride }) => {
  // Resolve the locale from the `[locale]` root param rather than from
  // `requestLocale`. Reading `requestLocale` lazily calls `headers()`, which
  // opts every consumer into dynamic rendering and makes next-intl unusable
  // inside a `use cache` boundary.
  let locale = localeOverride ?? (await localeRootParam());

  // Validate that the locale is supported, fallback to default if not
  if (!locale || !routing.locales.includes(locale as never)) {
    locale = routing.defaultLocale;
  }

  // Load all namespace files and merge them
  const messages = await loadMessages(locale);

  return {
    locale,
    messages,
    timeZone: 'UTC',
    onError(error) {
      if (isDevelopment) {
        // Missing translations are expected and should only log an error
        console.warn(`[Dev Only] i18n error: ${error.message}`);
      }
    },
    getMessageFallback(info) {
      return info.key;
    },
  };
});

/**
 * Loads translation messages for all namespaces.
 * Each namespace is loaded from a separate file for better code splitting.
 *
 * Cached because every `getTranslations()` call would otherwise count as
 * uncached I/O, which blocks prerendering — including inside
 * `generateMetadata()`. Messages only change on deploy.
 */
async function loadMessages(locale: string) {
  'use cache';
  cacheLife('max');

  const loadedMessages: Record<string, unknown> = {};

  // Load each namespace file
  await Promise.all(
    namespaces.map(async (namespace) => {
      try {
        const namespaceMessages = await import(
          `./messages/${locale}/${namespace}.json`
        );

        loadedMessages[namespace] = namespaceMessages.default;
      } catch (error) {
        console.warn(
          `Failed to load namespace "${namespace}" for locale "${locale}":`,
          error,
        );
        // Set empty object as fallback
        loadedMessages[namespace] = {};
      }
    }),
  );

  return loadedMessages;
}
