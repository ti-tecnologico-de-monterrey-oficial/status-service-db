import { expect } from 'chai';
import { getConfig, resetConfig, setConfig } from './config.js';

const envKeys = [
  'PORT',
  'CRED_STATUS_SERVICE',
  'CRED_STATUS_DID_SEED',
  'CONSOLE_LOG_LEVEL',
  'LOG_LEVEL',
  'ENABLE_ACCESS_LOGGING',
  'ENABLE_HTTPS_FOR_DEV',
  'ERROR_LOG_FILE',
  'ALL_LOG_FILE',
  'STATUS_CRED_SITE_ORIGIN',
  'CRED_STATUS_DB_URL',
  'CRED_STATUS_DB_HOST',
  'CRED_STATUS_DB_PORT',
  'CRED_STATUS_DB_USER',
  'CRED_STATUS_DB_PASS',
  'CRED_STATUS_DB_NAME',
  'STATUS_CRED_TABLE_NAME',
  'USER_CRED_TABLE_NAME',
  'CONFIG_TABLE_NAME',
  'EVENT_TABLE_NAME',
  'CRED_EVENT_TABLE_NAME'
];

const originalEnv = new Map(envKeys.map(key => [key, process.env[key]]));

describe('configuration', () => {
  beforeEach(() => {
    for (const key of envKeys) {
      delete process.env[key];
    }
    process.env.CRED_STATUS_SERVICE = 'mongodb';
    resetConfig();
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = originalEnv.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    resetConfig();
  });

  it('uses defaults and maps MongoDB environment variables', () => {
    const config = getConfig();

    expect(config.port).to.equal(4008);
    expect(config.credStatusService).to.equal('mongodb');
    expect(config.consoleLogLevel).to.equal('silly');
    expect(config.logLevel).to.equal('silly');
    expect(config.enableAccessLogging).to.equal(true);
    expect(config.enableHttpsForDev).to.equal(true);

    process.env.STATUS_CRED_SITE_ORIGIN = 'https://status.example.test';
    process.env.CRED_STATUS_DB_URL = 'mongodb://localhost/status';
    process.env.CRED_STATUS_DB_HOST = 'localhost';
    process.env.CRED_STATUS_DB_PORT = '27017';
    process.env.CRED_STATUS_DB_USER = 'user';
    process.env.CRED_STATUS_DB_PASS = 'secret';
    process.env.CRED_STATUS_DB_NAME = 'status';
    process.env.STATUS_CRED_TABLE_NAME = 'status-credentials';
    process.env.USER_CRED_TABLE_NAME = 'user-credentials';
    process.env.CONFIG_TABLE_NAME = 'config';
    process.env.EVENT_TABLE_NAME = 'events';
    process.env.CRED_EVENT_TABLE_NAME = 'credential-events';
    process.env.CRED_STATUS_DID_SEED = 'seed';
    process.env.PORT = '4100';
    process.env.CONSOLE_LOG_LEVEL = 'WARN';
    process.env.LOG_LEVEL = 'ERROR';
    resetConfig();

    const configured = getConfig();
    expect(configured.port).to.equal(4100);
    expect(configured.consoleLogLevel).to.equal('warn');
    expect(configured.logLevel).to.equal('error');
    expect(configured.statusCredSiteOrigin).to.equal('https://status.example.test');
    expect(configured.credStatusDatabaseUrl).to.equal('mongodb://localhost/status');
    expect(configured.credStatusDatabaseHost).to.equal('localhost');
    expect(configured.credStatusDatabasePort).to.equal('27017');
    expect(configured.credStatusDatabaseUsername).to.equal('user');
    expect(configured.credStatusDatabasePassword).to.equal('secret');
    expect(configured.credStatusDatabaseName).to.equal('status');
    expect(configured.statusCredTableName).to.equal('status-credentials');
    expect(configured.userCredTableName).to.equal('user-credentials');
    expect(configured.configTableName).to.equal('config');
    expect(configured.eventTableName).to.equal('events');
    expect(configured.credEventTableName).to.equal('credential-events');
    expect(configured.credStatusDidSeed).to.equal('seed');
  });

  it('parses true and false aliases case-insensitively', () => {
    for (const value of ['true', 't', 'yes', 'y', '1', 'TRUE']) {
      process.env.ENABLE_ACCESS_LOGGING = value;
      resetConfig();
      expect(getConfig().enableAccessLogging, value).to.equal(true);
    }

    for (const value of ['false', 'f', 'no', 'n', '0', 'FALSE']) {
      process.env.ENABLE_ACCESS_LOGGING = value;
      resetConfig();
      expect(getConfig().enableAccessLogging, value).to.equal(false);
    }
  });

  it('uses the boolean default for missing and unrecognized values', () => {
    expect(getConfig().enableAccessLogging).to.equal(true);

    process.env.ENABLE_ACCESS_LOGGING = 'sometimes';
    resetConfig();
    expect(getConfig().enableAccessLogging).to.equal(true);
  });

  it('caches the parsed config until reset', () => {
    const firstConfig = getConfig();
    process.env.PORT = '5000';

    expect(getConfig()).to.equal(firstConfig);
    expect(getConfig().port).to.equal(4008);

    resetConfig();
    expect(getConfig().port).to.equal(5000);
  });

  it('supports explicitly setting the parsed config', () => {
    setConfig();
    const config = getConfig();

    expect(config.port).to.equal(4008);
    expect(getConfig()).to.equal(config);
  });

  it('rejects unsupported credential status services', () => {
    process.env.CRED_STATUS_SERVICE = 'unsupported';

    expect(() => getConfig()).to.throw(
      'Encountered unsupported credential status service: unsupported'
    );
  });
});