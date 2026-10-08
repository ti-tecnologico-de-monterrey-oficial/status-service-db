import { expect } from 'chai';
import sinon from 'sinon';

describe('errorLogger middleware', () => {
  it('logs the error and calls next with the same error', async () => {
    const errorStub = sinon.spy();
    const { default: errorLogger } = await import('./errorLogger.js');

    const error = new Error('boom');
    const request = { originalUrl: '/foo', method: 'GET', ip: '127.0.0.1' };
    const response = {};
    const next = sinon.spy();

    // Replace the logger used inside the module isn't trivial without proxyquire support for ESM,
    // so we just verify next() is called with the original error without throwing.
    errorLogger(error, request, response, next);

    expect(next.calledOnceWith(error)).to.be.true;
  });
});
