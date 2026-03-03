/**
 * CitadelJson — JSON parsing utilities.
 *
 * Placed in 3_Game so it's available to all layers (4_World actions, 5_Mission command runner).
 * Provides lightweight JSON string extraction without full parser overhead.
 */
class CitadelJson
{
    static string ExtractString(string json, string key)
    {
        string search = "\"" + key + "\":\"";
        int pos = json.IndexOf(search);
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
        string ch;
        ch = json.Substring(start, 1);
        while (start < json.Length() && (ch == " " || ch == "\t"))
        {
            start++;
            ch = json.Substring(start, 1);
        }

        int end = start;
        ch = json.Substring(end, 1);
        while (end < json.Length() && ch != "," && ch != "}" && ch != " ")
        {
            end++;
            if (end < json.Length())
                ch = json.Substring(end, 1);
        }

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
        string search = "\"params\":{";
        int pos = json.IndexOf(search);
        if (pos < 0)
            return "{}";

        int start = pos + search.Length() - 1;
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
