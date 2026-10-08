import { expect } from 'chai';
import sinon from 'sinon';
import status from './status.js';
import { getUnsignedVC, getUnsignedVCWithStatus } from './test-fixtures/fixtures.js';

describe('status', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('initializeStatusManager / getStatusManager', () => {
    it('uses the provided status manager when passed in', async () => {
      const statusManagerStub = { marker: 'stub-a' };
      await status.initializeStatusManager(statusManagerStub);

      const statusManager = await status.getStatusManager();

      expect(statusManager).to.equal(statusManagerStub);
    });

    it('keeps the existing status manager when initialized again without args', async () => {
      const statusManagerStub = { marker: 'stub-b' };
      await status.initializeStatusManager(statusManagerStub);
      await status.initializeStatusManager();

      const statusManager = await status.getStatusManager();

      expect(statusManager).to.equal(statusManagerStub);
    });

    it('replaces the status manager when a new one is explicitly provided', async () => {
      await status.initializeStatusManager({ marker: 'stub-c' });
      const newStub = { marker: 'stub-d' };
      await status.initializeStatusManager(newStub);

      const statusManager = await status.getStatusManager();

      expect(statusManager).to.equal(newStub);
    });
  });

  describe('allocateRevocationStatus', () => {
    it('returns the vc unchanged if it already has a credentialStatus', async () => {
      await status.initializeStatusManager({});
      const vcWithStatus = getUnsignedVCWithStatus();

      const result = await status.allocateRevocationStatus(vcWithStatus);

      expect(result).to.eql(vcWithStatus);
    });

    it('delegates to the status manager when no credentialStatus is present', async () => {
      const vcWithStatus = getUnsignedVCWithStatus();
      const allocateRevocationStatus = sinon.fake.returns(vcWithStatus);
      await status.initializeStatusManager({ allocateRevocationStatus });

      const result = await status.allocateRevocationStatus(getUnsignedVC());

      expect(allocateRevocationStatus.calledOnce).to.be.true;
      expect(result).to.eql(vcWithStatus);
    });
  });

  describe('updateStatus', () => {
    it('revokes a credential', async () => {
      const revokeCredential = sinon.fake.resolves();
      await status.initializeStatusManager({ revokeCredential });

      const result = await status.updateStatus('urn:uuid:1', 'revoked');

      expect(revokeCredential.calledOnceWith('urn:uuid:1')).to.be.true;
      expect(result).to.eql({ code: 200, message: 'Credential successfully revoked.' });
    });

    it('suspends a credential', async () => {
      const suspendCredential = sinon.fake.resolves();
      await status.initializeStatusManager({ suspendCredential });

      const result = await status.updateStatus('urn:uuid:1', 'suspended');

      expect(suspendCredential.calledOnceWith('urn:uuid:1')).to.be.true;
      expect(result).to.eql({ code: 200, message: 'Credential successfully suspended.' });
    });

    it('unsuspends a credential', async () => {
      const unsuspendCredential = sinon.fake.resolves();
      await status.initializeStatusManager({ unsuspendCredential });

      const result = await status.updateStatus('urn:uuid:1', 'unsuspended');

      expect(unsuspendCredential.calledOnceWith('urn:uuid:1')).to.be.true;
      expect(result).to.eql({ code: 200, message: 'Credential successfully unsuspended.' });
    });

    it('returns 400 for an unsupported status', async () => {
      await status.initializeStatusManager({});

      const result = await status.updateStatus('urn:uuid:1', 'unknown-status');

      expect(result).to.eql({
        code: 400,
        message: 'Unsupported credential status: "unknown-status"'
      });
    });

    it('returns the error code/message when the status manager throws a known error', async () => {
      const error = new Error('Unable to find credential with ID urn:uuid:1');
      error.code = 404;
      const revokeCredential = sinon.fake.rejects(error);
      await status.initializeStatusManager({ revokeCredential });

      const result = await status.updateStatus('urn:uuid:1', 'revoked');

      expect(result).to.eql({ code: 404, message: error.message });
    });

    it('falls back to a 500 and default message when the error has no code/message', async () => {
      const revokeCredential = sinon.fake.rejects(new Error());
      await status.initializeStatusManager({ revokeCredential });

      const result = await status.updateStatus('urn:uuid:1', 'revoked');

      expect(result.code).to.equal(500);
      expect(result.message).to.contain('Unable to apply status "revoked"');
    });
  });

  describe('getCredentialInfo', () => {
    it('returns the credential info from the status manager', async () => {
      const credentialInfo = { credentialId: 'urn:uuid:1' };
      const getCredentialInfo = sinon.fake.returns(credentialInfo);
      await status.initializeStatusManager({ getCredentialInfo });

      const result = await status.getCredentialInfo('urn:uuid:1');

      expect(getCredentialInfo.calledOnceWith('urn:uuid:1')).to.be.true;
      expect(result).to.eql(credentialInfo);
    });

    it('propagates errors from the status manager', async () => {
      const error = new Error('not found');
      error.code = 404;
      const getCredentialInfo = sinon.fake.rejects(error);
      await status.initializeStatusManager({ getCredentialInfo });

      try {
        await status.getCredentialInfo('urn:uuid:1');
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).to.equal(error);
      }
    });
  });

  describe('getStatusCredential', () => {
    it('returns the status credential from the status manager', async () => {
      const statusCredential = { id: 'status-cred-id' };
      const getStatusCredential = sinon.fake.returns(statusCredential);
      await status.initializeStatusManager({ getStatusCredential });

      const result = await status.getStatusCredential('status-cred-id');

      expect(getStatusCredential.calledOnceWith('status-cred-id')).to.be.true;
      expect(result).to.eql(statusCredential);
    });

    it('propagates errors from the status manager', async () => {
      const error = new Error('not found');
      error.code = 404;
      const getStatusCredential = sinon.fake.rejects(error);
      await status.initializeStatusManager({ getStatusCredential });

      try {
        await status.getStatusCredential('unknown-id');
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).to.equal(error);
      }
    });
  });
});
