import { expect } from 'chai';
import { getConfig, setConfig, resetConfig } from './config.js';

const baseMongoEnv = {
  CRED_STATUS_SERVICE: 'mongodb',
  STATUS_CRED_SITE_ORIGIN: 'https://example.edu',
  CRED_STATUS_DB_URL: 'mongodb+srv://user:pass@domain.mongodb.net',
  CRED_STATUS_DID_SEED: 'seed'
};

describe('config', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    resetConfig();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfig();
  });

  function applyEnv(overrides) {
    process.env = { ...process.env, ...baseMongoEnv, ...overrides };
  }

  it('throws for an unsupported credential status service', () => {
    applyEnv({ CRED_STATUS_SERVICE: 'unsupported-service' });

    expect(() => setConfig()).to.throw('Encountered unsupported credential status service: unsupported-service');
  });

  it('uses the default port when PORT is not set', () => {
    applyEnv({ PORT: undefined });
    delete process.env.PORT;

    const config = getConfig();

    expect(config.port).to.equal(4008);
  });

  it('parses PORT from the environment when set', () => {
    applyEnv({ PORT: '1234' });

    const config = getConfig();

    expect(config.port).to.equal(1234);
  });

  it('caches the config so getConfig only parses once', () => {
    applyEnv({});
    const first = getConfig();
    process.env.PORT = '9999';
    const second = getConfig();

    expect(second).to.equal(first);
    expect(second.port).to.equal(first.port);
  });

  it('resetConfig forces re-parsing on next getConfig call', () => {
    applyEnv({ PORT: '1111' });
    const first = getConfig();
    resetConfig();
    applyEnv({ PORT: '2222' });
    const second = getConfig();

    expect(first.port).to.equal(1111);
    expect(second.port).to.equal(2222);
  });

  describe('enableAccessLogging boolean parsing', () => {
    const truthyValues = ['true', 'True', 't', 'yes', 'y', '1'];
    const falsyValues = ['false', 'False', 'f', 'no', 'n', '0'];

    truthyValues.forEach((value) => {
      it(`treats "${value}" as true`, () => {
        applyEnv({ ENABLE_ACCESS_LOGGING: value });
        expect(getConfig().enableAccessLogging).to.equal(true);
      });
    });

    falsyValues.forEach((value) => {
      it(`treats "${value}" as false`, () => {
        applyEnv({ ENABLE_ACCESS_LOGGING: value });
        expect(getConfig().enableAccessLogging).to.equal(false);
      });
    });

    it('defaults to true for an unrecognized value', () => {
      applyEnv({ ENABLE_ACCESS_LOGGING: 'not-a-boolean' });
      expect(getConfig().enableAccessLogging).to.equal(true);
    });

    it('defaults to true when not set', () => {
      applyEnv({ ENABLE_ACCESS_LOGGING: undefined });
      delete process.env.ENABLE_ACCESS_LOGGING;
      expect(getConfig().enableAccessLogging).to.equal(true);
    });
  });

  it('defaults consoleLogLevel and logLevel when not set', () => {
    applyEnv({ CONSOLE_LOG_LEVEL: undefined, LOG_LEVEL: undefined });
    delete process.env.CONSOLE_LOG_LEVEL;
    delete process.env.LOG_LEVEL;

    const config = getConfig();

    expect(config.consoleLogLevel).to.equal('silly');
    expect(config.logLevel).to.equal('silly');
  });

  it('lowercases consoleLogLevel and logLevel', () => {
    applyEnv({ CONSOLE_LOG_LEVEL: 'WARN', LOG_LEVEL: 'ERROR' });

    const config = getConfig();

    expect(config.consoleLogLevel).to.equal('warn');
    expect(config.logLevel).to.equal('error');
  });

  it('includes mongodb-specific envs when service is mongodb', () => {
    applyEnv({
      CRED_STATUS_DB_HOST: 'host',
      CRED_STATUS_DB_PORT: '27017',
      CRED_STATUS_DB_USER: 'user',
      CRED_STATUS_DB_PASS: 'pass',
      CRED_STATUS_DB_NAME: 'dbname'
    });

    const config = getConfig();

    expect(config.credStatusService).to.equal('mongodb');
    expect(config.credStatusDatabaseHost).to.equal('host');
    expect(config.credStatusDatabasePort).to.equal('27017');
    expect(config.credStatusDatabaseUsername).to.equal('user');
    expect(config.credStatusDatabasePassword).to.equal('pass');
    expect(config.credStatusDatabaseName).to.equal('dbname');
    expect(config.statusCredSiteOrigin).to.equal('https://example.edu');
  });

  it('returns a frozen config object', () => {
    applyEnv({});
    const config = getConfig();

    expect(Object.isFrozen(config)).to.equal(true);
  });
});
