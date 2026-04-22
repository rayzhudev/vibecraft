import { expect, test } from 'vitest';
import {
  parseLeadingMajorVersion,
  shouldEnableMacOSTahoeElectron41Workaround,
} from '../../../src/main/services/macosCompat';

test('parseLeadingMajorVersion extracts the first numeric segment', () => {
  expect(parseLeadingMajorVersion('41.1.0')).toBe(41);
  expect(parseLeadingMajorVersion('26.0')).toBe(26);
  expect(parseLeadingMajorVersion('')).toBeNull();
  expect(parseLeadingMajorVersion('not-a-version')).toBeNull();
});

test('shouldEnableMacOSTahoeElectron41Workaround only enables on macOS 26 + Electron 41+', () => {
  expect(
    shouldEnableMacOSTahoeElectron41Workaround({
      platform: 'darwin',
      electronVersion: '41.1.0',
      macosVersion: '26.0',
    })
  ).toBe(true);
  expect(
    shouldEnableMacOSTahoeElectron41Workaround({
      platform: 'darwin',
      electronVersion: '40.2.0',
      macosVersion: '26.0',
    })
  ).toBe(false);
  expect(
    shouldEnableMacOSTahoeElectron41Workaround({
      platform: 'darwin',
      electronVersion: '41.1.0',
      macosVersion: '15.5',
    })
  ).toBe(false);
  expect(
    shouldEnableMacOSTahoeElectron41Workaround({
      platform: 'linux',
      electronVersion: '41.1.0',
      macosVersion: '26.0',
    })
  ).toBe(false);
});
