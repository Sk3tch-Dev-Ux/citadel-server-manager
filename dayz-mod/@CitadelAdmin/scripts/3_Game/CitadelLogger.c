/**
 * CitadelLogger — Structured logging with ISO8601 timestamps, log levels, and rotation.
 *
 * Outputs to $profile:@Logging/Citadel.log with automatic rotation on startup.
 * Debug messages only output when debugEnabled is set in configuration.
 */
class CitadelLogger
{
    private static const string LOG_DIR = "$profile:@Logging";
    private string m_FullPath;
    private string m_ModIdentifier;
    private FileHandle m_FileHandle;
    private bool m_AllowDebug;

    void CitadelLogger(string modIdentifier, bool allowDebug = false)
    {
        m_ModIdentifier = modIdentifier;
        m_AllowDebug = allowDebug;
        Setup();
    }

    void ~CitadelLogger()
    {
        if (m_FileHandle != 0)
        {
            WriteClosingLine();
            CloseFile(m_FileHandle);
        }
    }

    void SetDebug(bool allowDebug) { m_AllowDebug = allowDebug; }

    void Debug(string message)
    {
        if (!m_AllowDebug) return;
        WriteLog("DEBUG\t", message);
    }

    void Info(string message)
    {
        WriteLog("INFO\t", message);
    }

    void Warn(string message)
    {
        WriteLog("WARN\t", message);
    }

    void Error(string message)
    {
        WriteLog("ERROR\t", message);
    }

    protected void WriteLog(string level, string message)
    {
        string logged = string.Format("%1 | [%2] %3", GetISO8601(), level, message);

        if (m_FileHandle != 0)
            FPrintln(m_FileHandle, logged);

        if (m_AllowDebug)
            Print(string.Format("[Citadel-Debug] %1", logged));
    }

    protected string GetISO8601()
    {
        int h, mi, s, d, mo, y;
        GetHourMinuteSecondUTC(h, mi, s);
        GetYearMonthDayUTC(y, mo, d);

        return string.Format("%1-%2-%3T%4:%5:%6Z", y.ToStringLen(4), mo.ToStringLen(2), d.ToStringLen(2), h.ToStringLen(2), mi.ToStringLen(2), s.ToStringLen(2));
    }

    static string GetISO8601Static()
    {
        int h, mi, s, d, mo, y;
        GetHourMinuteSecondUTC(h, mi, s);
        GetYearMonthDayUTC(y, mo, d);

        return string.Format("%1-%2-%3T%4:%5:%6Z", y.ToStringLen(4), mo.ToStringLen(2), d.ToStringLen(2), h.ToStringLen(2), mi.ToStringLen(2), s.ToStringLen(2));
    }

    protected void Setup()
    {
        m_FullPath = LOG_DIR + "/" + m_ModIdentifier + ".log";

        if (!FileExist(LOG_DIR))
        {
            MakeDirectory(LOG_DIR);
            if (!FileExist(LOG_DIR))
            {
                Print("[CitadelAdmin] ERROR: Failed to create log directory: " + LOG_DIR);
            }
        }

        // Log rotation: archive existing log
        if (FileExist(m_FullPath))
        {
            string pattern = m_FullPath + "*";
            string fileName;
            FileAttr fileAttributes;
            FindFileHandle fileSearch = FindFile(pattern, fileName, fileAttributes, FindFileFlags.ALL);

            int count = 0;
            if (fileSearch != 0)
            {
                count++;
                while (FindNextFile(fileSearch, fileName, fileAttributes))
                    count++;
                CloseFindFile(fileSearch);
            }

            string archiveName = m_FullPath + "." + count.ToString();
            CopyFile(m_FullPath, archiveName);
            DeleteFile(m_FullPath);
        }

        m_FileHandle = OpenFile(m_FullPath, FileMode.APPEND);
        WriteSeparator();
    }

    protected void WriteSeparator()
    {
        if (m_FileHandle != 0)
            FPrintln(m_FileHandle, string.Format("========================== %1 ==========================", GetISO8601()));
    }

    protected void WriteClosingLine()
    {
        if (m_FileHandle != 0)
            FPrintln(m_FileHandle, string.Format("EOF @ %1", GetISO8601()));
    }
};
