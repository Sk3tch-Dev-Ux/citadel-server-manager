'use strict';

const { parseServiceState, parseStartType } = require('../lib/service-installer');

// Representative `sc.exe query` output (English Windows).
const QUERY_RUNNING = `
SERVICE_NAME: Citadel
        TYPE               : 10  WIN32_OWN_PROCESS
        STATE              : 4  RUNNING
                                (STOPPABLE, NOT_PAUSABLE, ACCEPTS_SHUTDOWN)
        WIN32_EXIT_CODE    : 0  (0x0)
`;
const QUERY_STOPPED = `
SERVICE_NAME: Citadel
        STATE              : 1  STOPPED
`;
const QC_AUTO = `
[SC] QueryServiceConfig SUCCESS
SERVICE_NAME: Citadel
        START_TYPE         : 2   AUTO_START
        BINARY_PATH_NAME   : C:\\Citadel\\nssm.exe
`;
const QC_DEMAND = `
        START_TYPE         : 3   DEMAND_START
`;

describe('parseServiceState', () => {
  test('parses RUNNING', () => {
    expect(parseServiceState(QUERY_RUNNING)).toBe('running');
  });
  test('parses STOPPED', () => {
    expect(parseServiceState(QUERY_STOPPED)).toBe('stopped');
  });
  test('returns "unknown" when STATE is absent', () => {
    expect(parseServiceState('no state here')).toBe('unknown');
  });
  test('handles null/undefined safely', () => {
    expect(parseServiceState(null)).toBe('unknown');
    expect(parseServiceState(undefined)).toBe('unknown');
  });
});

describe('parseStartType', () => {
  test('parses AUTO_START', () => {
    expect(parseStartType(QC_AUTO)).toBe('auto_start');
  });
  test('parses DEMAND_START', () => {
    expect(parseStartType(QC_DEMAND)).toBe('demand_start');
  });
  test('returns null when START_TYPE is absent', () => {
    expect(parseStartType('nothing')).toBeNull();
    expect(parseStartType(null)).toBeNull();
  });
});
