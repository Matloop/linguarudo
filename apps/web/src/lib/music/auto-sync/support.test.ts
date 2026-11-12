import { describe, expect, test } from 'bun:test';
import { autoSyncSupported, type SupportNavigator } from './support';

const gdm = { getDisplayMedia: () => Promise.resolve() };

const UA = {
	chromeLinux:
		'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
	edgeWin:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
	firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
	safari:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
	chromeAndroid:
		'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
	chromeIos:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1'
};

describe('autoSyncSupported', () => {
	test('sem navigator ou sem getDisplayMedia: não', () => {
		expect(autoSyncSupported(undefined)).toBe(false);
		expect(autoSyncSupported({ userAgent: UA.chromeLinux })).toBe(false);
		expect(autoSyncSupported({ mediaDevices: {}, userAgent: UA.chromeLinux })).toBe(false);
	});

	test('UA-CH: Chromium de computador sim, celular não', () => {
		const desktop: SupportNavigator = {
			mediaDevices: gdm,
			userAgentData: {
				mobile: false,
				brands: [{ brand: 'Google Chrome' }, { brand: 'Chromium' }, { brand: 'Not=A?Brand' }]
			}
		};
		expect(autoSyncSupported(desktop)).toBe(true);
		expect(
			autoSyncSupported({ ...desktop, userAgentData: { ...desktop.userAgentData, mobile: true } })
		).toBe(false);
		// Marca sem "Chromium" não é confiável.
		expect(
			autoSyncSupported({
				mediaDevices: gdm,
				userAgentData: { mobile: false, brands: [{ brand: 'Outro' }] }
			})
		).toBe(false);
	});

	test('sem UA-CH (contexto não seguro): cai no user agent', () => {
		expect(autoSyncSupported({ mediaDevices: gdm, userAgent: UA.chromeLinux })).toBe(true);
		expect(autoSyncSupported({ mediaDevices: gdm, userAgent: UA.edgeWin })).toBe(true);
		expect(autoSyncSupported({ mediaDevices: gdm, userAgent: UA.firefox })).toBe(false);
		expect(autoSyncSupported({ mediaDevices: gdm, userAgent: UA.safari })).toBe(false);
		expect(autoSyncSupported({ mediaDevices: gdm, userAgent: UA.chromeAndroid })).toBe(false);
		expect(autoSyncSupported({ mediaDevices: gdm, userAgent: UA.chromeIos })).toBe(false);
	});
});
