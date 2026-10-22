import { expect, vi } from 'vitest';
import request from 'supertest';
import {
  validCredentialId,
  invalidCredentialId,
  invalidCredentialIdErrorMessage,
  getUnsignedVC,
  getUnsignedVCWithStatus,
  getValidStatusUpdateBody,
  getInvalidStatusUpdateBody
} from './test-fixtures/fixtures.js';
import status from './status.js';
import { build } from './app.js';

const allocateEndpoint = '/credentials/status/allocate';
const updateEndpoint = '/credentials/status';
const emptyStatusManagerStub = {};

describe('api', () => {
  describe('GET /', () => {
    it('GET / => hello', async () => {
      await status.initializeStatusManager(emptyStatusManagerStub);
      const app = await build();

      const response = await request(app)
        .get('/');

      expect(response.header['content-type']).to.have.string('json');
      expect(response.status).to.equal(200);
      expect(response.body.message).to.equal('status-service-db server status: ok.');
    });
  });

  describe('GET /unknown/path', () => {
    it('unknown endpoint returns 404', async () => {
      await status.initializeStatusManager(emptyStatusManagerStub);
      const app = await build();

      const response = await request(app)
        .get('/unknown/path');

      expect(response.status).to.equal(404);
    }, 10000);
  });

  describe(`POST ${allocateEndpoint}`, () => {
    it('returns 400 if no body', async () => {
      await status.initializeStatusManager(emptyStatusManagerStub);
      const app = await build();

      const response = await request(app)
        .post(allocateEndpoint);

      expect(response.header['content-type']).to.have.string('json');
      expect(response.status).to.equal(400);
    });

    it('returns updated credential', async () => {
      const unsignedVCWithStatus = getUnsignedVCWithStatus();
      const allocateRevocationStatus = vi.fn().mockReturnValue(unsignedVCWithStatus);
      const statusManagerStub = { allocateRevocationStatus };
      await status.initializeStatusManager(statusManagerStub);
      const app = await build();

      const response = await request(app)
        .post(allocateEndpoint)
        .send(getUnsignedVC());

      expect(response.header['content-type']).to.have.string('json');
      expect(response.status).to.equal(200);
      expect(response.body).to.eql(unsignedVCWithStatus);
    });

    it('returns an internal server error when allocation fails without a message', async () => {
      const allocateRevocationStatus = vi.fn().mockRejectedValue(new Error());
      await status.initializeStatusManager({ allocateRevocationStatus });
      const app = await build();

      const response = await request(app)
        .post(allocateEndpoint)
        .send(getUnsignedVC());

      expect(response.status).to.equal(500);
    });

    it('keeps the original message when allocation fails with one', async () => {
      const allocateRevocationStatus = vi.fn().mockRejectedValue(new Error('database offline'));
      await status.initializeStatusManager({ allocateRevocationStatus });
      const app = await build();

      const response = await request(app)
        .post(allocateEndpoint)
        .send(getUnsignedVC());

      expect(response.status).to.equal(500);
      expect(response.body.message).to.contain('database offline');
    });

    it('returns unchanged credential when status already set ', async () => {
      const allocateRevocationStatus = vi.fn().mockReturnValue(getUnsignedVCWithStatus());
      const statusManagerStub = { allocateRevocationStatus };
      await status.initializeStatusManager(statusManagerStub);
      const app = await build();

      const response = await request(app)
        .post(allocateEndpoint)
        .send(getUnsignedVCWithStatus());

      expect(response.header['content-type']).to.have.string('json');
      expect(response.status).to.equal(200);
      expect(response.body).to.eql(getUnsignedVCWithStatus());
    });
  });

  describe(`POST ${updateEndpoint}`, () => {
    it('returns 400 if no body', async () => {
      await status.initializeStatusManager(emptyStatusManagerStub);
      const app = await build();

      const response = await request(app)
        .post(updateEndpoint);

      expect(response.header['content-type']).to.have.string('json');
      expect(response.status).to.equal(400);
    });

    it('returns update from revoked credential', async () => {
      const revokeCredential = vi.fn().mockReturnValue({
        code: 200,
        message: 'Credential successfully revoked.'
      });
      const statusManagerStub = { revokeCredential };
      await status.initializeStatusManager(statusManagerStub);
      const app = await build();

      const response = await request(app)
        .post(updateEndpoint)
        .send(getValidStatusUpdateBody(validCredentialId, 'revoked'));

      expect(response.header['content-type']).to.have.string('json');
      expect(response.status).to.equal(200);
      expect(response.body.message).to.equal('Credential successfully revoked.');
    });

    it('returns update from suspended credential', async () => {
      const suspendCredential = vi.fn().mockReturnValue({
        code: 200,
        message: 'Credential successfully suspended.'
      });
      const statusManagerStub = { suspendCredential };
      await status.initializeStatusManager(statusManagerStub);
      const app = await build();

      const response = await request(app)
        .post(updateEndpoint)
        .send(getValidStatusUpdateBody(validCredentialId, 'suspended'));

      expect(response.header['content-type']).to.have.string('json');
      expect(response.status).to.equal(200);
      expect(response.body.message).to.equal('Credential successfully suspended.');
    });

    it('returns update from unsuspended credential', async () => {
      const unsuspendCredential = vi.fn().mockReturnValue({
        code: 200,
        message: 'Credential successfully unsuspended.'
      });
      const statusManagerStub = { unsuspendCredential };
      await status.initializeStatusManager(statusManagerStub);
      const app = await build();

      const response = await request(app)
        .post(updateEndpoint)
        .send(getValidStatusUpdateBody(validCredentialId, 'unsuspended'));

      expect(response.header['content-type']).to.have.string('json');
      expect(response.status).to.equal(200);
      expect(response.body.message).to.equal('Credential successfully unsuspended.');
    });

    it('returns 400 for an unsupported credential status', async () => {
      await status.initializeStatusManager(emptyStatusManagerStub);
      const app = await build();

      const response = await request(app)
        .post(updateEndpoint)
        .send(getValidStatusUpdateBody(validCredentialId, 'pending'));

      expect(response.status).to.equal(400);
      expect(response.body.message).to.equal('Unsupported credential status: "pending"');
    });

    it('returns 400 and does not update when the status type is not supported', async () => {
      const revokeCredential = vi.fn().mockResolvedValue();
      await status.initializeStatusManager({ revokeCredential });
      const app = await build();

      const response = await request(app)
        .post(updateEndpoint)
        .send({
          credentialId: validCredentialId,
          credentialStatus: [{ type: 'StatusList2021Credential', status: 'revoked' }]
        });

      expect(response.status).to.equal(400);
      expect(response.body.message).to.contain('BitstringStatusListCredential is the only supported status type.');
      expect(revokeCredential).not.toHaveBeenCalled();
    });

    it('returns 500 with a default message when the update fails unexpectedly', async () => {
      await status.initializeStatusManager(emptyStatusManagerStub);
      const app = await build();
      const updateStatus = vi.spyOn(status, 'updateStatus').mockRejectedValue({});

      try {
        const response = await request(app)
          .post(updateEndpoint)
          .send(getValidStatusUpdateBody(validCredentialId, 'revoked'));

        expect(response.status).to.equal(500);
        expect(response.body.message).to.contain('Error updating credential status position.');
      } finally {
        updateStatus.mockRestore();
      }
    });

    it('keeps the message of an unexpected update failure', async () => {
      await status.initializeStatusManager(emptyStatusManagerStub);
      const app = await build();
      const updateStatus = vi.spyOn(status, 'updateStatus').mockRejectedValue(new Error('database offline'));

      try {
        const response = await request(app)
          .post(updateEndpoint)
          .send(getValidStatusUpdateBody(validCredentialId, 'revoked'));

        expect(response.status).to.equal(500);
        expect(response.body.message).to.contain('database offline');
      } finally {
        updateStatus.mockRestore();
      }
    });

    it('returns 404 for unknown credential id', async () => {
      const missingCredentialError = new Error(invalidCredentialIdErrorMessage);
      missingCredentialError.code = 404;
      const revokeCredential = vi.fn().mockRejectedValue(missingCredentialError);
      const statusManagerStub = { revokeCredential };
      await status.initializeStatusManager(statusManagerStub);
      const app = await build();

      const response = await request(app)
        .post(updateEndpoint)
        .send(getInvalidStatusUpdateBody(invalidCredentialId, 'revoked'));

      expect(response.header['content-type']).to.have.string('json');
      expect(response.status).to.equal(404);
      expect(response.body.message).to.contain('Unable to find credential with ID');
    });
  });

  describe('GET /credentials/:credentialId', () => {
    it('returns credential information', async () => {
      const credentialInfo = { id: validCredentialId };
      const getCredentialInfo = vi.fn().mockReturnValue(credentialInfo);
      await status.initializeStatusManager({ getCredentialInfo });
      const app = await build();

      const response = await request(app).get(`/credentials/${validCredentialId}`);

      expect(response.status).to.equal(200);
      expect(response.body).to.eql(credentialInfo);
      expect(getCredentialInfo).toHaveBeenCalledExactlyOnceWith(validCredentialId);
    });

    it('forwards credential lookup errors', async () => {
      const failure = new Error('credential missing');
      failure.code = 404;
      const getCredentialInfo = vi.fn().mockRejectedValue(failure);
      await status.initializeStatusManager({ getCredentialInfo });
      const app = await build();

      const response = await request(app).get(`/credentials/${validCredentialId}`);

      expect(response.status).to.equal(404);
      expect(response.body.message).to.contain('credential missing');
    });
  });

  describe('GET /:statusCredentialId', () => {
    it('returns a status credential', async () => {
      const statusCredential = { id: 'status-list-1' };
      const getStatusCredential = vi.fn().mockReturnValue(statusCredential);
      await status.initializeStatusManager({ getStatusCredential });
      const app = await build();

      const response = await request(app).get('/status-list-1');

      expect(response.status).to.equal(200);
      expect(response.body).to.eql(statusCredential);
      expect(getStatusCredential).toHaveBeenCalledExactlyOnceWith('status-list-1');
    });

    it('forwards status credential lookup errors', async () => {
      const failure = new Error('status list missing');
      failure.code = 404;
      const getStatusCredential = vi.fn().mockRejectedValue(failure);
      await status.initializeStatusManager({ getStatusCredential });
      const app = await build();

      const response = await request(app).get('/status-list-missing');

      expect(response.status).to.equal(404);
      expect(response.body.message).to.contain('status list missing');
    });
  });
});
