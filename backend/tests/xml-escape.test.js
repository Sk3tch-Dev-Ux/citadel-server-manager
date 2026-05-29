'use strict';

const { escapeXml, escapeXmlText } = require('../lib/xml-escape');

describe('xml-escape', () => {
  describe('escapeXml (attribute values)', () => {
    test('escapes all five predefined XML entities', () => {
      expect(escapeXml('&')).toBe('&amp;');
      expect(escapeXml('<')).toBe('&lt;');
      expect(escapeXml('>')).toBe('&gt;');
      expect(escapeXml('"')).toBe('&quot;');
      expect(escapeXml("'")).toBe('&apos;');
    });

    test('escapes ampersand before other entities (no double-escaping)', () => {
      expect(escapeXml('a & b < c')).toBe('a &amp; b &lt; c');
      // The literal text "&lt;" must become "&amp;lt;", not stay "&lt;"
      expect(escapeXml('&lt;')).toBe('&amp;lt;');
    });

    test('collapses CR/LF/TAB to a single space (attributes cannot span lines)', () => {
      expect(escapeXml('a\nb')).toBe('a b');
      expect(escapeXml('a\r\nb')).toBe('a b');
      expect(escapeXml('a\tb')).toBe('a b');
    });

    test('coerces non-string input to string', () => {
      expect(escapeXml(42)).toBe('42');
      expect(escapeXml(0)).toBe('0');
      expect(escapeXml(null)).toBe('null');
      expect(escapeXml(undefined)).toBe('undefined');
    });

    test('leaves ordinary identifiers untouched', () => {
      expect(escapeXml('AKM_Suppressor')).toBe('AKM_Suppressor');
      expect(escapeXml('Ammo_762x39')).toBe('Ammo_762x39');
    });
  });

  describe('escapeXmlText (element text content)', () => {
    test('escapes the five entities', () => {
      expect(escapeXmlText('a & b < c > d " e \' f')).toBe(
        'a &amp; b &lt; c &gt; d &quot; e &apos; f'
      );
    });

    test('preserves whitespace including newlines', () => {
      expect(escapeXmlText('a\nb\tc')).toBe('a\nb\tc');
    });
  });
});
