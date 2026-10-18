import { describe, it, expect } from 'vitest';
import { locales, defaultLocale, localeNames } from '@/core/lib/i18n/config';
import fs from 'fs';
import path from 'path';

describe('i18n config', () => {
    it('has 12 locales', () => {
        expect(locales).toHaveLength(12);
    });

    it('includes required locales', () => {
        for (const locale of ['en', 'tr', 'az', 'de', 'es', 'et', 'fr', 'it', 'pl', 'pt', 'ru', 'zh']) {
            expect(locales).toContain(locale);
        }
    });

    it('default locale is en', () => {
        expect(defaultLocale).toBe('en');
    });

    it('every locale has a name', () => {
        for (const locale of locales) {
            expect(localeNames[locale]).toBeTruthy();
        }
    });

    it('every locale has a message file', () => {
        const messagesDir = path.resolve(__dirname, '../../messages-core');
        for (const locale of locales) {
            const filePath = path.join(messagesDir, `${locale}.json`);
            expect(fs.existsSync(filePath), `Missing: messages-core/${locale}.json`).toBe(true);
        }
    });

    it('all message files have the same keys', () => {
        const messagesDir = path.resolve(__dirname, '../../messages-core');
        const flatKeys = (obj: Record<string, unknown>, prefix = ''): string[] => {
            const keys: string[] = [];
            for (const [k, v] of Object.entries(obj)) {
                const full = prefix ? `${prefix}.${k}` : k;
                if (typeof v === 'object' && v !== null) {
                    keys.push(...flatKeys(v as Record<string, unknown>, full));
                } else {
                    keys.push(full);
                }
            }
            return keys.sort();
        };

        const enKeys = flatKeys(JSON.parse(fs.readFileSync(path.join(messagesDir, 'en.json'), 'utf-8')));

        for (const locale of locales) {
            if (locale === 'en') continue;
            const keys = flatKeys(JSON.parse(fs.readFileSync(path.join(messagesDir, `${locale}.json`), 'utf-8')));
            expect(keys, `${locale}.json keys mismatch`).toEqual(enKeys);
        }
    });
});
