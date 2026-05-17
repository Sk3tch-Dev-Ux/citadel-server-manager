/**
 * Convert the dayzexpansion.com wiki schema format into JSON-Schema draft-07.
 *
 * Upstream shape (per settings file):
 *   { id, name, description, filePath, linkedModId, settingsSchema: [Field...] }
 *
 * Field shape:
 *   { name, type, example, description, defaultValue,
 *     enumValues?, arrayItems?, mapKeyType?, mapValueType?, nestedSettings?, toolLink? }
 *
 * Citadel's SchemaEditor.jsx consumes draft-07 with `properties{}` and the
 * boolean-toggle convention `type: integer, enum: [0,1]`.
 *
 * Pure function — no I/O. Tested via scripts/sync-expansion-docs/sync.js.
 */

/** Strip wrapping double-quotes the upstream uses on string defaults. */
function unquote(s) {
  if (typeof s !== 'string') return s;
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}

/** Parse a defaultValue/example string into the appropriate JS type. */
function parseDefault(raw, type) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  switch (type) {
    case 'int':
    case 'bool':
    case 'enum':
    case 'color': {
      const n = parseInt(raw, 10);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'float': {
      const n = parseFloat(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'string':
    case 'classname':
    case 'icon':
    case 'enum_string':
    case 'vector':
      return unquote(raw);
    case 'array':
      // Upstream defaults like "[231 items]" are placeholders, not real data.
      return [];
    case 'object':
    case 'map':
      return {};
    default:
      return unquote(raw);
  }
}

/** Convert a single upstream field to a draft-07 property schema. */
function convertField(field) {
  const { type, description, defaultValue, example, enumValues, toolLink,
          mapKeyType, mapValueType, nestedSettings } = field;

  const out = {};
  if (description) out.description = description;

  // Preserve the example so future tooling (tooltips, "reset to example") can use it.
  if (example !== undefined && example !== '' && example !== null) {
    out.examples = [example];
  }

  // Preserve the wiki's tool link as a custom extension so the frontend can
  // surface "Open in ARGB calculator", etc.
  if (toolLink) out['x-toolLink'] = toolLink;

  switch (type) {
    case 'int':
      out.type = 'integer';
      break;

    case 'float':
      out.type = 'number';
      break;

    case 'bool':
      // Citadel convention: render as checkbox via integer enum [0,1]
      out.type = 'integer';
      out.enum = [0, 1];
      break;

    case 'enum':
      // Numeric selector — upstream doesn't enumerate values for `enum` (only
      // for `enum_string`). Leave as plain integer; description usually carries
      // the valid range.
      out.type = 'integer';
      break;

    case 'enum_string':
      out.type = 'string';
      if (Array.isArray(enumValues) && enumValues.length) {
        out.enum = enumValues.map(v => v.value);
        // Stash labels for richer dropdowns down the road.
        out['x-enumLabels'] = enumValues.reduce((acc, v) => {
          acc[v.value] = v.label;
          return acc;
        }, {});
      }
      break;

    case 'color':
      out.type = 'integer';
      out.format = 'argb-int';
      break;

    case 'vector':
      // DayZ vectors are stored as "x, y, z" comma-separated strings in JSON.
      out.type = 'string';
      out.format = 'vector3';
      break;

    case 'classname':
      out.type = 'string';
      out.format = 'dayz-classname';
      break;

    case 'icon':
      out.type = 'string';
      out.format = 'expansion-icon';
      break;

    case 'string':
      out.type = 'string';
      break;

    case 'array': {
      out.type = 'array';
      if (Array.isArray(nestedSettings) && nestedSettings.length) {
        // Array of objects — nestedSettings describes each item's properties.
        out.items = {
          type: 'object',
          properties: convertFields(nestedSettings),
        };
      } else {
        // Array of primitives — we can't always know the item type; default to string.
        out.items = { type: 'string' };
      }
      break;
    }

    case 'object': {
      out.type = 'object';
      if (Array.isArray(nestedSettings) && nestedSettings.length) {
        out.properties = convertFields(nestedSettings);
      }
      break;
    }

    case 'map': {
      // JSON object with arbitrary keys. Express via additionalProperties.
      out.type = 'object';
      const valSchema = {};
      switch (mapValueType) {
        case 'int': valSchema.type = 'integer'; break;
        case 'float': valSchema.type = 'number'; break;
        case 'bool': valSchema.type = 'integer'; valSchema.enum = [0, 1]; break;
        case 'string': valSchema.type = 'string'; break;
        default: /* leave open */ break;
      }
      out.additionalProperties = Object.keys(valSchema).length ? valSchema : true;
      if (mapKeyType) out['x-mapKeyType'] = mapKeyType;
      break;
    }

    default:
      // Unknown type — leave open and tag so we can find them later.
      out['x-unknownUpstreamType'] = type;
      break;
  }

  // Default value (best-effort parse).
  const parsedDefault = parseDefault(defaultValue, type);
  if (parsedDefault !== undefined) out.default = parsedDefault;

  return out;
}

/** Convert an array of upstream fields into a properties object. */
function convertFields(fields) {
  const props = {};
  for (const f of fields) {
    if (!f || !f.name) continue;
    props[f.name] = convertField(f);
  }
  return props;
}

/**
 * Convert a full upstream settings doc into a draft-07 schema.
 * @param {object} upstream - parsed mods/<mod>/settings/<File>.schema.json
 * @param {object} [meta]   - optional context: { modId, displayName }
 */
function convertSchema(upstream, meta = {}) {
  const fields = Array.isArray(upstream.settingsSchema) ? upstream.settingsSchema : [];
  const modId = meta.modId ?? upstream.linkedModId;

  const schema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: meta.displayName ?? upstream.name ?? 'Expansion Settings',
    type: 'object',
    'x-source': 'dayzexpansion.com',
    'x-modId': modId,
    'x-filePath': upstream.filePath,
    properties: convertFields(fields),
  };

  if (upstream.description) schema.description = upstream.description;
  return schema;
}

module.exports = { convertSchema, convertField, convertFields, parseDefault, unquote };
