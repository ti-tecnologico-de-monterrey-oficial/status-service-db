import { expect, vi } from 'vitest';
import status from './status.js';

describe('status manager operations', () => {
  it('initializes with an injected manager and returns the same manager', async () => {
    const statusManager = {};

    await status.initializeStatusManager(statusManager);

    expect(await status.getStatusManager()).to.equal(statusManager);
  });

  it('keeps an existing manager when initialized without an argument', async () => {
    const statusManager = {};
    await status.initializeStatusManager(statusManager);

    await status.initializeStatusManager();

    expect(await status.getStatusManager()).to.equal(statusManager);
  });

  it('allocates status when the credential has no status', async () => {
    const credential = { id: 'credential-1' };
    const credentialWithStatus = { ...credential, credentialStatus: [{ statusListIndex: 1 }] };
    const allocateRevocationStatus = vi.fn().mockResolvedValue(credentialWithStatus);
    await status.initializeStatusManager({ allocateRevocationStatus });

    const result = await status.allocateRevocationStatus(credential);

    expect(result).to.equal(credentialWithStatus);
    expect(allocateRevocationStatus).toHaveBeenCalledExactlyOnceWith(credential);
  });

  it('returns the same credential when it already has status', async () => {
    const credential = { credentialStatus: [{ statusListIndex: 1 }] };
    const allocateRevocationStatus = vi.fn();
    await status.initializeStatusManager({ allocateRevocationStatus });

    expect(await status.allocateRevocationStatus(credential)).to.equal(credential);
    expect(allocateRevocationStatus).not.toHaveBeenCalled();
  });

  it('propagates allocation failures', async () => {
    const failure = new Error('allocation failed');
    const allocateRevocationStatus = vi.fn().mockRejectedValue(failure);
    await status.initializeStatusManager({ allocateRevocationStatus });

    try {
      await status.allocateRevocationStatus({});
      expect.fail('expected allocation to fail');
    } catch (error) {
      expect(error).to.equal(failure);
    }
  });

  for (const [credentialStatus, methodName, expectedMessage] of [
    ['revoked', 'revokeCredential', 'Credential successfully revoked.'],
    ['suspended', 'suspendCredential', 'Credential successfully suspended.'],
    ['unsuspended', 'unsuspendCredential', 'Credential successfully unsuspended.']
  ]) {
    it(`applies the ${credentialStatus} status`, async () => {
      const managerMethod = vi.fn().mockResolvedValue();
      await status.initializeStatusManager({ [methodName]: managerMethod });

      expect(await status.updateStatus('credential-1', credentialStatus)).to.eql({
        code: 200,
        message: expectedMessage
      });
      expect(managerMethod).toHaveBeenCalledExactlyOnceWith('credential-1');
    });
  }

  it('returns a client error for an unsupported status', async () => {
    await status.initializeStatusManager({});

    expect(await status.updateStatus('credential-1', 'unknown')).to.eql({
      code: 400,
      message: 'Unsupported credential status: "unknown"'
    });
  });

  it('preserves manager error codes and messages', async () => {
    const failure = new Error('already revoked');
    failure.code = 409;
    const revokeCredential = vi.fn().mockRejectedValue(failure);
    await status.initializeStatusManager({ revokeCredential });

    expect(await status.updateStatus('credential-1', 'revoked')).to.eql({
      code: 409,
      message: 'already revoked'
    });
  });

  it('uses fallback status error values when manager errors omit them', async () => {
    const failure = new Error();
    Object.defineProperty(failure, 'message', { value: undefined });
    const revokeCredential = vi.fn().mockRejectedValue(failure);
    await status.initializeStatusManager({ revokeCredential });

    expect(await status.updateStatus('credential-1', 'revoked')).to.eql({
      code: 500,
      message: 'Unable to apply status "revoked" to credential with ID "credential-1".'
    });
  });

  it('forwards credential info and status credential lookups', async () => {
    const credentialInfo = { id: 'credential-1' };
    const statusCredential = { id: 'status-list-1' };
    const getCredentialInfo = vi.fn().mockResolvedValue(credentialInfo);
    const getStatusCredential = vi.fn().mockResolvedValue(statusCredential);
    await status.initializeStatusManager({ getCredentialInfo, getStatusCredential });

    expect(await status.getCredentialInfo('credential-1')).to.equal(credentialInfo);
    expect(await status.getStatusCredential('status-list-1')).to.equal(statusCredential);
    expect(getCredentialInfo).toHaveBeenCalledExactlyOnceWith('credential-1');
    expect(getStatusCredential).toHaveBeenCalledExactlyOnceWith('status-list-1');
  });

  it('propagates lookup failures', async () => {
    const failure = new Error('lookup failed');
    const getCredentialInfo = vi.fn().mockRejectedValue(failure);
    await status.initializeStatusManager({ getCredentialInfo });

    try {
      await status.getCredentialInfo('credential-1');
      expect.fail('expected lookup to fail');
    } catch (error) {
      expect(error).to.equal(failure);
    }
  });
});