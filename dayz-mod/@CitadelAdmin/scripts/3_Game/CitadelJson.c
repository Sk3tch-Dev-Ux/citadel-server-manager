/**
 * CitadelJson — JSON parsing utilities.
 *
 * Placed in 3_Game so it's available to all layers (4_World actions, 5_Mission command runner).
 * Provides lightweight JSON string extraction without full parser overhead.
 *
 * PERFORMANCE: Optimized for compact JSON from sidecar (no spaces after colons).
 *   - ExtractFloat: Limited whitespace scan (max 4 chars) to avoid unbounded
 *     Substring() loop allocating strings per character.
 *   - ExtractString: Fast path for compact format first.
 */
class CitadelJson
{
    static string ExtractString(string json, string key)
    {
        // Try compact format: "key":"value"
        string search = "\"" + key + "\":\"";
        int pos = json.IndexOf(search);

        // Fallback: space after colon: "key": "value"
        if (pos < 0)
        {
            search = "\"" + key + "\": \"";
            pos = json.IndexOf(search);
        }

        if (pos < 0)
            return "";

        int start = pos + search.Length();
        int end = json.IndexOfFrom(start, "\"");
        if (end < 0)
            return "";

        return json.Substring(start, end - start);
    }

    static float ExtractFloat(string json, string key)
    {
        string strVal = ExtractString(json, key);
        if (strVal != "")
            return strVal.ToFloat();

        string search = "\"" + key + "\":";
        int pos = json.IndexOf(search);
        if (pos < 0)
            return 0;

        int start = pos + search.Length();

        // Skip whitespace — bounded to 4 chars max (sidecar writes compact JSON)
        // Each Substring() allocates a new string, so we limit iterations.
        int maxSkip = start + 4;
        if (maxSkip > json.Length()) maxSkip = json.Length();
        string ch;
        while (start < maxSkip)
        {
            ch = json.Substring(start, 1);
            if (ch != " " && ch != "\t")
                break;
            start++;
        }

        if (start >= json.Length())
            return 0;

        // Find end of numeric value using IndexOfFrom (avoids per-char Substring loop)
        int endComma = json.IndexOfFrom(start, ",");
        int endBrace = json.IndexOfFrom(start, "}");
        int endSpace = json.IndexOfFrom(start, " ");

        // Pick the nearest delimiter
        int end = json.Length();
        if (endComma >= 0 && endComma < end) end = endComma;
        if (endBrace >= 0 && endBrace < end) end = endBrace;
        if (endSpace >= 0 && endSpace < end) end = endSpace;

        if (end <= start)
            return 0;

        return json.Substring(start, end - start).ToFloat();
    }

    static int ExtractInt(string json, string key)
    {
        float val = ExtractFloat(json, key);
        int result = val;
        return result;
    }

    static string ExtractParams(string json)
    {
        // Try compact format: "params":{
        string search = "\"params\":{";
        int pos = json.IndexOf(search);

        // Fallback: space variants: "params": { or "params":{
        if (pos < 0)
        {
            search = "\"params\": {";
            pos = json.IndexOf(search);
        }
        if (pos < 0)
        {
            search = "\"params\":  {";
            pos = json.IndexOf(search);
        }

        if (pos < 0)
            return "{}";

        // Find the opening brace within the search match
        int bracePos = json.IndexOfFrom(pos, "{");
        if (bracePos < 0)
            return "{}";

        int start = bracePos;
        int depth = 0;
        int i = start;
        string ch;
        while (i < json.Length())
        {
            ch = json.Substring(i, 1);
            if (ch == "{") depth++;
            else if (ch == "}") depth--;
            if (depth == 0)
                return json.Substring(start, i - start + 1);
            i++;
        }
        return "{}";
    }
};
