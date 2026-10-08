import { expect } from 'chai';
import sinon from 'sinon';
import invalidPathHandler from './invalidPathHandler.js';

describe('invalidPathHandler middleware', () => {
  it('responds with a 404 and a message that includes the original url', () => {
    const sendSpy = sinon.spy();
    const statusStub = sinon.stub().returns({ send: sendSpy });
    const response = { status: statusStub, statusMessage: 'Not Found' };
    const request = { originalUrl: '/unknown/path', method: 'GET', ip: '127.0.0.1' };

    invalidPathHandler(request, response);

    expect(statusStub.calledOnceWith(404)).to.be.true;
    expect(sendSpy.calledOnce).to.be.true;
    const payload = sendSpy.firstCall.args[0];
    expect(payload.code).to.equal(404);
    expect(payload.message).to.contain('/unknown/path');
  });
});
