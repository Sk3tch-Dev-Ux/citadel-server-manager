'use strict';

/**
 * Regression tests for the mission-file XML serializers. Before the xml-escape
 * fix, a value containing `&`, `<`, `>` or `"` produced malformed XML that the
 * DayZ server silently rejects, corrupting the economy config. These tests lock
 * in that every builder escapes user-supplied string attributes.
 */

const { buildGlobalsXml } = require('../lib/globals-xml-parser');
const { eventToXml, buildEventsXml } = require('../lib/events-xml-parser');
const { buildLimitsXml } = require('../lib/limits-parser');
const { buildTypesXml } = require('../lib/types-xml-parser');

// A parsed-back round trip is the strongest check: the output must be
// well-formed XML whose attribute values decode to the original strings.
const { XMLParser } = require('fast-xml-parser');
const parse = (xml) =>
  new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(xml);

describe('globals-xml-parser escaping', () => {
  test('escapes special characters in name/type/value attributes', () => {
    const xml = buildGlobalsXml([{ name: 'Foo&Bar', type: '0', value: '3 < 4 & "x"' }]);
    expect(xml).toContain('name="Foo&amp;Bar"');
    expect(xml).toContain('value="3 &lt; 4 &amp; &quot;x&quot;"');
    // Must round-trip cleanly through a real XML parser.
    const v = parse(xml).variables.var;
    expect(v['@_name']).toBe('Foo&Bar');
    expect(v['@_value']).toBe('3 < 4 & "x"');
  });

  test('ordinary globals are unchanged', () => {
    const xml = buildGlobalsXml([{ name: 'ZombieMaxCount', type: '0', value: '1000' }]);
    expect(xml).toContain('<var name="ZombieMaxCount" type="0" value="1000"/>');
  });
});

describe('events-xml-parser escaping', () => {
  const base = {
    nominal: 1, min: 0, max: 1, lifetime: 1, restock: 0,
    saferadius: 1, distanceradius: 1, cleanupradius: 1,
  };

  test('escapes the event name attribute', () => {
    const frag = eventToXml({ ...base, name: 'Loot & <Stuff>' });
    expect(frag).toContain('<event name="Loot &amp; &lt;Stuff&gt;">');
  });

  test('escapes secondary and position text content', () => {
    const frag = eventToXml({ ...base, name: 'X', secondary: 'a&b', position: 'x<y' });
    expect(frag).toContain('<secondary>a&amp;b</secondary>');
    expect(frag).toContain('<position>x&lt;y</position>');
  });

  test('escapes child type attribute', () => {
    const frag = eventToXml({
      ...base, name: 'X',
      children: [{ lootmax: 1, lootmin: 0, max: 1, min: 0, type: 'A&B' }],
    });
    expect(frag).toContain('type="A&amp;B"');
  });

  test('full document round-trips through a parser', () => {
    const xml = buildEventsXml([{ ...base, name: 'Event&One' }]);
    const ev = parse(xml).events.event;
    expect(ev['@_name']).toBe('Event&One');
  });
});

describe('limits-parser escaping', () => {
  test('escapes category/usage/value/tag names', () => {
    const xml = buildLimitsXml({
      categories: ['weapons&tools'],
      usages: ['Military<>'],
      values: ['Tier"1"'],
      tags: ["floor'd"],
    });
    expect(xml).toContain('<category name="weapons&amp;tools"/>');
    expect(xml).toContain('<usage name="Military&lt;&gt;"/>');
    expect(xml).toContain('<value name="Tier&quot;1&quot;"/>');
    expect(xml).toContain('<tag name="floor&apos;d"/>');
  });
});

describe('types-xml-parser escaping', () => {
  const item = {
    name: 'Item&<Test>', nominal: 1, lifetime: 1, restock: 0, min: 1,
    quantmin: -1, quantmax: -1, cost: 100,
    count_in_cargo: 0, count_in_hoarder: 0, count_in_map: 1, count_in_player: 0,
    crafted: 0, deloot: 0,
    category: 'tools&food', usage: ['Military<'], value: [], tag: [],
  };

  test('escapes type name, category, and usage/value/tag names', () => {
    const xml = buildTypesXml([item], '', null);
    expect(xml).toContain('<type name="Item&amp;&lt;Test&gt;">');
    expect(xml).toContain('<category name="tools&amp;food"/>');
    expect(xml).toContain('<usage name="Military&lt;"/>');
    // Numeric children are emitted verbatim (no spurious escaping).
    expect(xml).toContain('<nominal>1</nominal>');
  });
});
